#!/usr/bin/env node
/** secret-guard.mjs — SEC-001 / T_B51A1FF3: mechanical guard against secrets in
 * Kanban comments, evidence, and completion summaries.
 *
 * A pre_tool_call hook that matches ^kanban_comment$|^kanban_create$|^kanban_complete$
 * (and, per advisory A5, kanban_request_review / kanban_block / kanban_request_changes)
 * and BLOCKS any call whose text (body / summary / evidence fields) contains a
 * secret-shaped value.
 *
 * Only the RULE ID is quoted in the block reason — never the matched value.
 *
 * Pattern scope (conservative, expandable):
 *   - Telegram bot token:  [0-9]{8,12}:[A-Za-z0-9_-]{35}
 *   - Generic API key shapes:  key=<hex>, token=<hex>, password=<..>, secret=<..>
 *   - AWS key id:  AKIA[0-9A-Z]{16}
 *   - Generic 32/40/64-hex strings flagged by common key-name prefixes
 *
 * Hermes wire format (hook mode):
 *   The hook reads a JSON payload on stdin with these top-level keys:
 *     hook_event_name  — "pre_tool_call"
 *     tool_name        — e.g. "kanban_comment"
 *     tool_input       — the tool's own input dict (if the caller passed it here)
 *     args             — ALSO the tool's input dict (Hermes _payload_fields promotes
 *                        kwargs["args"] → top-level "args"; this is the shape `hermes
 *                        hooks test --payload-file` produces when you put args there)
 *     session_id
 *     cwd
 *     profile
 *     extra            — everything else, including tool_input/task_id/body if they were
 *                        not consumed by _payload_fields
 *   To be robust across both call conventions, scanPayload() reads from BOTH
 *   tool_input and args (whichever is a dict), and from extra as a fallback.
 *
 * Three modes:
 *   hook   — reads a Hermes pre_tool_call payload on stdin; emits {} (allow) or
 *            {decision:"block", reason:...} + exit 2.
 *   check  — one-shot text scan:  echo "some text" | node secret-guard.mjs check
 *            exits 1 if a secret shape is found, 0 otherwise.
 *   audit  — whole-board scan: every comment + every done-card summary scanned;
 *            exit 1 on any hit (used for one-off forensics, not enforcement).
 *
 * Exit codes: 0 = clean · 1 = secret found (check/audit) · 2 = hook block · 3 = error.
 *
 * Zero npm dependencies. Reads the board through sqlite3 CLI / node:sqlite.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

// ─── Policy: secret shapes ──────────────────────────────────────────────────

/** Telegram bot API token:  <digits>:<30-45 char base64url-like>  */
const TELEGRAM_BOT_TOKEN_RE =
  /\b[0-9]{8,12}:[A-Za-z0-9_-]{30,45}\b/;

/** AWS access key id (not secret, but often pasted alongside) */
const AWS_ACCESS_KEY_ID_RE = /\bAKIA[0-9A-Z]{16}\b/;

/**
 * Generic "key=<value>" / "token=<value>" / "password=<value>" / "secret=<value>"
 * where the value is long enough to be a real secret (>= 16 chars) and looks
 * non-trivial (not "placeholder", not "redacted", not "xxx").
 *
 * The value part is captured so we can length-check it but we NEVER emit it.
 */
const KEY_VALUE_RE = /\b(key|token|password|secret|api_key|api_secret|apikey|auth_token|access_token|bearer)\s*=\s*([A-Za-z0-9_\-\/+]{16,})/i;

/** Generic long hex string (32/40/64) preceded by a secret-hint word */
const LONG_HEX_WITH_HINT_RE = /\b(sk|secret|key|token|password|hash|auth|session|cookie|refresh|id_token)\s*[:=]\s*([0-9a-fA-F]{32,64})\b/;

/** Matchers that apply to plain text (check / audit mode). */
const TEXT_MATCHERS = [
  { name: "R_SECRET_TELEGRAM_BOT_TOKEN", re: TELEGRAM_BOT_TOKEN_RE },
  { name: "R_SECRET_AWS_ACCESS_KEY_ID", re: AWS_ACCESS_KEY_ID_RE },
  { name: "R_SECRET_KEY_VALUE_PAIR",     re: KEY_VALUE_RE },
  { name: "R_SECRET_LONG_HEX_WITH_HINT", re: LONG_HEX_WITH_HINT_RE },
];

// ─── Board access (mirrors signoff-gate.mjs pattern) ────────────────────────

export class SecretGuardError extends Error {}

function sql(dbPath, query) {
  if (!existsSync(dbPath)) throw new SecretGuardError(`board database not found: ${dbPath}`);
  try {
    const out = execFileSync("sqlite3", ["-json", "--", dbPath, query], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const trimmed = out.trim();
    return trimmed ? JSON.parse(trimmed) : [];
  } catch (e) {
    if (e.code === "ENOENT") return sqlViaNode(dbPath, query);
    const detail = (e.stderr || e.message || "").toString().trim().slice(0, 300);
    throw new SecretGuardError(`sqlite3 failed on ${dbPath}: ${detail}`);
  }
}

function sqlViaNode(dbPath, query) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite"));
  } catch (e) {
    throw new SecretGuardError(`no sqlite3 binary on PATH and node:sqlite unavailable (${e.message})`);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(query).all();
  } catch (e) {
    throw new SecretGuardError(`node:sqlite query failed: ${e.message}`);
  } finally {
    db.close();
  }
}

export function loadBoard(dbPath) {
  const tasks = sql(dbPath, "SELECT id, title, body, assignee, status, completed_at, created_at FROM tasks");
  const comments = sql(dbPath, "SELECT task_id, author, body, created_at FROM task_comments ORDER BY created_at");
  const runs = sql(
    dbPath,
    "SELECT task_id, profile, status, outcome, summary, metadata, started_at, ended_at FROM task_runs ORDER BY started_at",
  );
  const byTask = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.task_id)) m.set(r.task_id, []);
      m.get(r.task_id).push(r);
    }
    return m;
  };
  return {
    tasks,
    taskById: new Map(tasks.map((t) => [t.id, t])),
    commentsByTask: byTask(comments),
    runsByTask: byTask(runs),
  };
}

// ─── Secret scanning ─────────────────────────────────────────────────────────

/**
 * Scan a single string for any secret shape.
 * Returns the matching RULE ID(s), never the matched text.
 * Multiple matches on the same string are deduplicated by rule id.
 */
export function scanText(text) {
  if (typeof text !== "string") return [];
  const hits = new Set();
  for (const { name, re } of TEXT_MATCHERS) {
    if (re.test(text)) hits.add(name);
  }
  return [...hits];
}

/**
 * Collect every text-bearing field from a hook payload, across the Hermes wire
 * conventions:
 *   - tool_input (dict or string) — the tool's own input
 *   - args (dict or string)        — Hermes _payload_fields promotes kwargs["args"]
 *                                    to top-level "args"; `hermes hooks test` produces
 *                                    this shape when the fixture puts args there
 *   - extra (dict)                 — leftover fields, may also carry tool_input/body
 *   - top-level body / summary / result / artifacts / reason — some callers flatten
 *     the tool input onto the payload itself
 *
 * For each guarded tool we know which fields carry the human-authored text; we
 * scan all of them so the guard is robust to either wire shape.
 */
function collectTextSources(payload) {
  const sources = [];
  const seen = new WeakSet();

  // Helper: if `obj` is a dict, push its known text fields; if a string, push it.
  const pushDict = (obj, fields) => {
    if (!obj || typeof obj !== "object") return;
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const f of fields) {
      const v = obj[f];
      if (typeof v === "string" && v) sources.push(v);
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string" && item) sources.push(item);
        }
      }
    }
  };

  const tool = payload?.tool_name || "";

  // Top-level string fields (some callers flatten tool_input onto the payload)
  for (const f of ["body", "summary", "result", "reason", "title"]) {
    const v = payload && typeof payload[f] === "string" ? payload[f] : null;
    if (v) sources.push(v);
  }
  // Top-level artifacts array
  if (Array.isArray(payload?.artifacts)) {
    for (const item of payload.artifacts) {
      if (typeof item === "string" && item) sources.push(item);
    }
  }

  // tool_input (the tool's own input dict)
  pushDict(payload?.tool_input, toolInputFields(tool));
  // args (Hermes _payload_fields promotes kwargs["args"] → top-level "args")
  pushDict(payload?.args, toolInputFields(tool));
  // extra (leftover fields — may also carry tool_input/body if not consumed)
  pushDict(payload?.extra, [
    "body", "summary", "result", "reason", "title", "task_id",
  ]);
  // extra.tool_input (some callers nest it here)
  pushDict(payload?.extra?.tool_input, toolInputFields(tool));

  // Deduplicate by string identity
  const out = [];
  const seenStr = new Set();
  for (const s of sources) {
    if (!seenStr.has(s)) {
      seenStr.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Which fields of a tool's input dict carry human-authored text, per tool. */
function toolInputFields(tool) {
  switch (tool) {
    case "kanban_comment":
      return ["body"];
    case "kanban_create":
      return ["body", "title"];
    case "kanban_complete":
      return ["summary", "result", "artifacts"];
    case "kanban_request_review":
      return ["summary"];
    case "kanban_block":
      return ["reason"];
    case "kanban_request_changes":
      return ["reason"];
    default:
      return [];
  }
}

/** Guarded tools — expandable; current card scope (D1/A5) covers these six. */
const GUARDED_TOOLS = new Set([
  "kanban_comment",
  "kanban_create",
  "kanban_complete",
  "kanban_request_review",
  "kanban_block",
  "kanban_request_changes",
]);

/**
 * Scan a kanban_comment / kanban_create / kanban_complete / kanban_request_review
 * / kanban_block / kanban_request_changes payload's text fields.
 * For kanban_complete, also scan the summary, result, top-level artifacts and any
 * evidence paths in metadata (both tool_input.metadata and extra.metadata).
 */
export function scanPayload(payload) {
  const hits = new Set();
  const tool = payload?.tool_name || "";

  if (!GUARDED_TOOLS.has(tool)) return [];

  const textSources = collectTextSources(payload);

  // Extra: if tool_input / extra carry a metadata field, scan its evidence paths too
  const metadataSources = [];
  const meta = payload?.tool_input?.metadata ?? payload?.extra?.metadata ?? payload?.metadata;
  if (typeof meta === "string") {
    metadataSources.push(meta);
  } else if (meta && typeof meta === "object") {
    for (const key of ["evidence", "artifacts", "evidence_paths"]) {
      if (Array.isArray(meta[key])) {
        for (const item of meta[key]) {
          if (typeof item === "string") metadataSources.push(item);
        }
      }
    }
  }
  for (const text of metadataSources) {
    for (const hit of scanText(text)) hits.add(hit);
  }

  for (const text of textSources) {
    for (const hit of scanText(text)) hits.add(hit);
  }

  return [...hits];
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

function defaultDbPath() {
  if (process.env.HERMES_KANBAN_DB) return process.env.HERMES_KANBAN_DB;
  const shared = join(homedir(), ".hermes", "kanban.db");
  if (existsSync(shared)) return shared;
  return join(process.env.HERMES_HOME || join(homedir(), ".hermes"), "kanban.db");
}

function killSwitchPath() {
  const candidates = [
    join(process.env.HERMES_HOME || join(homedir(), ".hermes"), "secret-guard.disabled"),
    join(homedir(), ".hermes", "secret-guard.disabled"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0] || "hook";
  const db = typeof args.db === "string" && args.db ? args.db : defaultDbPath();

  if (mode === "hook") return hookMode(db);
  if (mode === "check") return checkMode();
  if (mode === "audit") return auditMode(db);
  console.error(`secret-guard: unknown mode "${mode}" (expected hook | check | audit)`);
  process.exit(3);
}

function hookMode(defaultDb) {
  const allow = () => {
    process.stdout.write("{}\n");
    process.exit(0);
  };
  const block = (ruleIds) => {
    const reason = buildBlockReason(ruleIds);
    process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
    process.exit(2);
  };

  const kill = killSwitchPath();
  if (kill) {
    process.stderr.write(`secret-guard: kill switch active (${kill}) — allowing call\n`);
    return allow();
  }

  let payload = {};
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    return block(["R_SECRET_PARSE_ERROR"]);
  }

  const tool = payload.tool_name || "";
  if (!GUARDED_TOOLS.has(tool)) return allow();

  const hits = scanPayload(payload);
  if (hits.length === 0) return allow();

  return block(hits);
}

function buildBlockReason(ruleIds) {
  const unique = [...new Set(ruleIds)];
  if (unique.includes("R_SECRET_PARSE_ERROR")) {
    return [
      "secret-guard: blocked — R_SECRET_PARSE_ERROR: the hook payload could not be parsed.",
      "Failing closed — check the card manually. The block reason quotes rule ids only; no secret value is included.",
      "Policy: SEC-001 (no secrets in board) + T_B51A1FF3 · tool: secret-guard.mjs",
    ].join("\n");
  }
  return [
    `secret-guard: blocked — the call text matches secret-shaped patterns (rule ids: ${unique.join(", ")}).`,
    "No secret value is quoted in this reason — only rule ids. Do not paste the value into any repo file, evidence, log, or chat.",
    "Distribution channel for secrets: profile `.env` only (or a local file outside the repo). A worker that needs one reads it programmatically.",
    "Policy: SEC-001 (no secrets in board) + T_B51A1FF3 · tool: secret-guard.mjs",
  ].join("\n");
}

function checkMode() {
  const text = readFileSync(0, "utf8");
  const hits = scanText(text);
  if (hits.length > 0) {
    console.error(`secret-guard check: secret-shaped pattern(s) found: ${hits.join(", ")}`);
    console.error("No value is printed — rule ids only.");
    process.exit(1);
  }
  process.exit(0);
}

function auditMode(db) {
  let board;
  try {
    board = loadBoard(db);
  } catch (e) {
    console.error(`secret-guard audit: ${e.message}`);
    process.exit(3);
  }

  const hitsByTask = new Map();

  for (const task of board.tasks) {
    const taskHits = new Set();
    for (const c of board.commentsByTask.get(task.id) || []) {
      for (const hit of scanText(c.body || "")) taskHits.add(hit);
    }
    if (task.status === "done") {
      for (const r of board.runsByTask.get(task.id) || []) {
        if (typeof r.summary === "string") {
          for (const hit of scanText(r.summary)) taskHits.add(hit);
        }
        if (typeof r.metadata === "string") {
          try {
            const obj = JSON.parse(r.metadata);
            if (typeof obj === "object" && obj !== null) {
              for (const key of ["evidence", "artifacts", "evidence_paths"]) {
                if (Array.isArray(obj[key])) {
                  for (const item of obj[key]) {
                    if (typeof item === "string") {
                      for (const hit of scanText(item)) taskHits.add(hit);
                    }
                  }
                }
              }
            }
          } catch {}
        }
      }
    }
    if (taskHits.size > 0) hitsByTask.set(task.id, [...taskHits]);
  }

  if (hitsByTask.size === 0) {
    console.log(`secret-guard audit: clean — no secret-shaped values on the board (db: ${db})`);
    process.exit(0);
  }

  console.error(`secret-guard audit: ${hitsByTask.size} task(s) carry secret-shaped text (db: ${db})`);
  for (const [tid, rules] of hitsByTask) {
    const task = board.taskById.get(tid);
    console.error(`  ${tid} ${task ? task.title : ""} @${task ? task.assignee : ""} [${rules.join(", ")}]`);
  }
  console.error("No values are printed — rule ids only.");
  process.exit(1);
}

const invoked = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (invoked) {
  try {
    main();
  } catch (e) {
    const mode = (process.argv[2] || "") === "hook";
    process.stderr.write(`secret-guard: internal error: ${e.stack || e.message}\n`);
    if (mode) {
      process.stdout.write(JSON.stringify({ decision: "block", reason: `secret-guard: internal error — failing closed (${e.message})` }) + "\n");
      process.exit(2);
    }
    process.exit(3);
  }
}
