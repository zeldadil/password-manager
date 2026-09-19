#!/usr/bin/env node
/**
 * signoff-gate.mjs — QA-001h QA sign-off gate (`t_430aa9a3`)
 *
 * Machine-enforces the board rule from TEST_STRATEGY §11/§12 and
 * `QA_SIGN_OFF_GATE.md`: **no task reaches `done` without a QA verdict and
 * attached evidence.**
 *
 * Three modes:
 *
 *   audit            Every `done` card on the board is evaluated. Cards completed
 *                    before the gate epoch are reported as advisory (grandfathered);
 *                    cards completed at/after the epoch fail the run (exit 1).
 *   check --task ID  One card, evaluated even when it is not `done` yet
 *                    (`--pre-complete`) — this is what the completion hook calls.
 *   hook             Reads a Hermes `pre_tool_call` shell-hook payload on stdin
 *                    (JSON). Emits `{}` (allow) or a block directive and exits 2.
 *
 * Exit codes: 0 = pass · 1 = gate violations (audit/check) · 2 = hook block ·
 *             3 = internal error (audit/check; hook mode fails closed with 2).
 *
 * Zero npm dependencies. Reads the board through the `sqlite3` CLI (primary —
 * present on this host and on ubuntu GitHub runners) or `node:sqlite`
 * (Node >= 22.5 fallback).
 *
 * Usage:
 *   node scripts/qa/signoff-gate.mjs audit  [--db PATH] [--repo PATH] [--epoch-iso ISO]
 *                                           [--strict-history] [--json]
 *   node scripts/qa/signoff-gate.mjs check --task t_xxxxxxxx [--pre-complete] [--json]
 *   echo '<pre_tool_call payload>' | node scripts/qa/signoff-gate.mjs hook
 *
 * Fail-closed on genuinely unverifiable input only (t_5455942d):
 *   - the task id is resolved from the payload (`tool_input.task_id`, then a
 *     task-id-shaped `extra.task_id`) and, when the payload carries no usable id,
 *     from the worker's location (`$HERMES_KANBAN_WORKSPACE`, `cwd`,
 *     `$HERMES_KANBAN_BRANCH`) — Hermes scrubs `$HERMES_KANBAN_TASK` from hook
 *     subprocesses, so a session id is never treated as a card;
 *   - R5 resolves the evidence paths of the **operative (newest)** verdict only,
 *     and accepts a path that exists on any ref of the checkout;
 *   - the "linked QA child ⇒ deferral" heuristic is suppressed once the card
 *     carries an explicit verdict;
 *   - a deferral marker is operative only while it is the **newest** QA record
 *     on the card (§3 "the newest source is the operative verdict"): a
 *     `QA-VERDICT: deferred — t_xxxxxxxx` comment that a later verdict has
 *     superseded is history, not a live block (t_58280940);
 *   - R5 resolves only the evidence the operative verdict **claims**: the paths
 *     inside an `Evidence:`/`Artifacts:` label, or — when the comment carries no
 *     label — the paths outside code spans/fences. A path the verdict merely
 *     *cites* about another card is reported as `A6_EVIDENCE_CITED` and never as
 *     this card's missing evidence (t_99e408c5; QA_SIGN_OFF_GATE.md §5.7).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Policy constants (mirror QA_SIGN_OFF_GATE.md — change both together)
// ─────────────────────────────────────────────────────────────────────────────

/** Cards completed before this instant are grandfathered (advisory only). */
export const GATE_EPOCH_ISO = "2026-09-17T15:00:00Z";

/** Verdict vocabulary — TEST_STRATEGY §12. */
export const VERDICTS = new Set(["pass", "pass-with-conditions", "fail", "blocked"]);

/** A `done` card carrying one of these verdicts is a gate failure. */
const TERMINAL_BAD_VERDICTS = new Set(["fail", "blocked"]);

/** Profiles allowed to record an independent QA verdict. */
const QA_PROFILES = new Set(["qa"]);

/** Profiles allowed to record the Architect half of an AR-6 sign-off. */
const ARCHITECT_PROFILES = new Set(["architect"]);

const VERDICT_MARKER_RE = /(?:^|[\s(])qa[\s_-]*verdict\s*:\s*([a-z][a-z-]*)/i;
const VERDICT_LOOSE_RE = /verdict\s*[:\-—]+\s*([a-z][a-z-]*)/i;
// Same leading boundary as VERDICT_MARKER_RE (t_c3cb6842): a marker that only
// appears inside a code span — a handoff quoting the recording command, a
// troubleshooting transcript — is documentation, not a live deferral
// (t_58280940: frontend's gate-defect report quoted the marker and the gate
// then judged *that* quote as the card's live deferral target).
const DEFERRAL_RE = /(?:^|[\s(])qa[\s_-]*verdict\s*[:\-—]+\s*deferred/i;
const EXCEPTION_RE = /qa[\s_-]*signoff[\s_-]*exception\s*[:\-—]+\s*(\S[^\n]*)/i;
const ARCH_SIGNOFF_RE = /(arch[\s_-]*(verdict|sign[\s_-]*off)|approv|signed[\s_-]*off|LGTM)/i;
const TASK_ID_RE = /\bt_[0-9a-f]{8}\b/g;
const TEST_TYPES_RE = /test\s*types\s*:?\**\s*([^\n]+)/i;
const SECURITY_TRACK_RE =
  /\b(packages\/crypto|crypto[\s-]*(primitive|implementation|boundary|module|package)|KDF|AEAD|Argon2id|vault[\s-]*key|bridge[\s-]*protocol|bridge[\s-]*message|autofill)\b/i;
const NOTE_FOLLOWUP_RE = /\b(follow[\s-]*up|t_[0-9a-f]{8}|https:\/\/github\.com\/\S+\/(issues|pull)\/\d+)\b/i;

/**
 * A board task id (`t_5455942d`). Anything else in a hook payload — the Hermes
 * session id (`20260917_201256_021f5e`), a run id, a tool-call id — is NOT a
 * task id and must never be resolved as one (t_5455942d defect 1).
 */
export const TASK_ID_SHAPE_RE = /^t_[0-9a-z]+$/;

/** Evidence pointers: CI run / PR / issue URLs, repo-relative or absolute file paths. */
const EVIDENCE_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:actions\/runs\/\d+|pull\/\d+|issues\/\d+)[\w#/?=&.-]*/gi;
const EVIDENCE_MD_LINK_RE = /\]\(([^)\s]+)\)/g;
const EVIDENCE_PATH_RE = /(?:^|[\s`("'[])((?:tests|apps|packages|scripts|docs|architecture|\.github)\/[\w./@-]+\.[a-z0-9]{1,8})(?=[\s`)"'\].,;:]|$)/gim;
const EVIDENCE_ABS_RE = /(?:^|[\s`("'[])(\/[\w./@-]+\.[a-z0-9]{1,8})(?=[\s`)"'\].,;:]|$)/gm;
const EVIDENCE_DIR_RE = /(?:^|[\s`("'[])((?:tests|docs|architecture)\/[\w./-]+\/)(?=[\s`)"'\].,;:]|$)/gm;

/**
 * The **evidence label** (§5.7): the recorded convention that separates the
 * evidence a verdict claims from a path it merely cites about another card.
 * `Evidence:` — bold (`**Evidence:**`), bulleted, or mid-sentence — plus
 * `Artifacts:` / `Attachments:`.
 */
const EVIDENCE_LABEL_RE = /(?:^|[^\w])(?:evidence|artifacts?|attachments?)[ \t]*(?::|—|–)/gi;

// ─────────────────────────────────────────────────────────────────────────────
// Claimed vs cited evidence (§5.7, t_99e408c5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Character ranges of markdown code spans (`` `…` ``) and fenced blocks in a
 * comment body. A path inside them is documentation — a pasted command, a quoted
 * recording template, a defect transcript — rather than evidence, by the same
 * principle that already governs deferral markers (t_c3cb6842 / t_58280940).
 */
export function codeRanges(text) {
  const ranges = [];
  let offset = 0;
  let fence = null;
  for (const line of text.split("\n")) {
    const start = offset;
    const m = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) fence = { start, token: m[1][0] };
      else if (m[1][0] === fence.token) {
        ranges.push([fence.start, start + line.length]);
        fence = null;
      }
    }
    offset = start + line.length + 1;
  }
  if (fence) ranges.push([fence.start, text.length]);
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "`" || insideRanges(i, ranges)) continue;
    let n = 0;
    while (text[i + n] === "`") n++;
    const close = closingBackticks(text, i + n, n, ranges);
    i += n - 1;
    if (close === -1) continue;
    ranges.push([i, close + n]);
    i = close + n - 1;
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** Offset of the next backtick run of exactly `n` backticks, outside `ranges`. */
function closingBackticks(text, from, n, ranges) {
  for (let j = from; j < text.length; j++) {
    if (text[j] !== "`" || insideRanges(j, ranges)) continue;
    let run = 0;
    while (text[j + run] === "`") run++;
    if (run === n) return j;
    j += run - 1;
  }
  return -1;
}

function insideRanges(index, ranges) {
  return ranges.some(([a, b]) => index >= a && index < b);
}

/**
 * The regions an operative verdict claims as its own evidence: from just after
 * each evidence label to the end of that paragraph (a blank line, heading or
 * table row closes it). A label *inside* a code span/fence is a quoted template,
 * not a claim.
 */
function evidenceLabelRegions(text, ranges) {
  const regions = [];
  for (const m of text.matchAll(EVIDENCE_LABEL_RE)) {
    if (insideRanges(m.index, ranges)) continue;
    const start = m.index + m[0].length;
    const stop = text.slice(start).search(/\n[ \t]*\n|\n#{1,6}[ \t]|\n[ \t]*\|/);
    regions.push([start, stop === -1 ? text.length : start + stop]);
  }
  return regions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Board access
// ─────────────────────────────────────────────────────────────────────────────

export class BoardError extends Error {}

let sqliteError = null;

function sql(dbPath, query) {
  if (!existsSync(dbPath)) throw new BoardError(`board database not found: ${dbPath}`);
  try {
    const out = execFileSync("sqlite3", ["-json", "--", dbPath, query], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const trimmed = out.trim();
    return trimmed ? JSON.parse(trimmed) : [];
  } catch (e) {
    if (e instanceof BoardError) throw e;
    if (e.code === "ENOENT") return sqlViaNode(dbPath, query);
    const detail = (e.stderr || e.message || "").toString().trim().slice(0, 300);
    throw new BoardError(`sqlite3 failed on ${dbPath}: ${detail}`);
  }
}

function sqlViaNode(dbPath, query) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite"));
  } catch (e) {
    throw new BoardError(`no sqlite3 binary on PATH and node:sqlite unavailable (${e.message})`);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(query).all();
  } catch (e) {
    if (/unable to open database/i.test(String(e.message))) throw new BoardError(`cannot open board ${dbPath}: ${e.message}`);
    throw new BoardError(`node:sqlite query failed: ${e.message}`);
  } finally {
    db.close();
  }
}

export function loadBoard(dbPath) {
  const tasks = sql(dbPath, "SELECT id, title, assignee, status, completed_at, body, created_at FROM tasks");
  const comments = sql(dbPath, "SELECT task_id, author, body, created_at FROM task_comments ORDER BY created_at");
  const attachments = sql(dbPath, "SELECT task_id, filename, size, uploaded_by, stored_path FROM task_attachments");
  const runs = sql(
    dbPath,
    "SELECT id, task_id, profile, status, outcome, summary, metadata, ended_at, started_at FROM task_runs ORDER BY started_at",
  );
  const links = sql(dbPath, "SELECT parent_id, child_id FROM task_links");
  const byTask = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.task_id)) m.set(r.task_id, []);
      m.get(r.task_id).push(r);
    }
    return m;
  };
  // Index the runs by their own id as well: the dispatcher can hand the hook a
  // run id instead of a task id, and the board knows which card that run belongs
  // to (t_5455942d defect 1 — resolve from the board, never guess).
  const runsById = new Map(runs.filter((r) => r.id !== undefined && r.id !== null).map((r) => [String(r.id), r]));
  return {
    tasks,
    taskById: new Map(tasks.map((t) => [t.id, t])),
    commentsByTask: byTask(comments),
    attachmentsByTask: byTask(attachments),
    runsByTask: byTask(runs),
    runsById,
    links,
    childrenOf: (id) => links.filter((l) => l.parent_id === id).map((l) => l.child_id),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule evaluation
// ─────────────────────────────────────────────────────────────────────────────

export function testTypesOf(task) {
  const m = TEST_TYPES_RE.exec(task.body || "");
  return m ? m[1].toLowerCase() : "";
}

function normalizeVerdictToken(raw) {
  if (!raw) return null;
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z-]/g, "");
}

/**
 * Every verdict source on the card, oldest → newest.
 * Precedence: explicit `QA-VERDICT:` marker comment > QA-authored "verdict"
 * comment > completed-run metadata `verdict` (the structured handoff).
 */
export function collectVerdicts(board, task) {
  const found = [];
  for (const c of board.commentsByTask.get(task.id) || []) {
    const text = c.body || "";
    const marker = VERDICT_MARKER_RE.exec(text);
    if (marker) {
      found.push({
        token: normalizeVerdictToken(marker[1]),
        raw: marker[1],
        source: "marker-comment",
        author: c.author,
        comment: text,
        at: c.created_at,
      });
      continue;
    }
    if (QA_PROFILES.has(String(c.author || "").trim())) {
      const loose = VERDICT_LOOSE_RE.exec(text);
      if (loose) {
        found.push({
          token: normalizeVerdictToken(loose[1]),
          raw: loose[1],
          source: "qa-comment",
          author: c.author,
          comment: text,
          at: c.created_at,
        });
      }
    }
  }
  for (const r of board.runsByTask.get(task.id) || []) {
    const md = parseJson(r.metadata);
    if (!md) continue;
    for (const key of ["verdict", "qa_verdict", "qaVerdict"]) {
      if (typeof md[key] === "string") {
        found.push({
          token: normalizeVerdictToken(md[key]),
          raw: md[key],
          source: "run-metadata",
          author: r.profile,
          comment: r.summary || "",
          at: r.ended_at || r.started_at,
          runId: r.id ?? null,
        });
      }
    }
  }
  return found.sort((a, b) => (a.at || 0) - (b.at || 0));
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * A QA deferral is legal only when it points at a real, QA-owned card
 * (either an explicit `QA-VERDICT: deferred — t_xxxxxxxx` comment or a linked
 * child card whose assignee is a QA profile).
 *
 * Only the **newest** deferral marker is operative (§3: "when several sources
 * exist, the newest one is the operative verdict"), and a marker that a later
 * QA verdict has superseded is history — otherwise a stale `deferred — t_...`
 * comment blocks a card whose verdict has already landed, forever
 * (t_58280940: R8 was evaluated on the *oldest* marker unconditionally, even
 * when a valid verdict was recorded after it, so the card could never reach
 * `done`).
 *
 * The linked-child heuristic is a *fallback for a card that records no verdict
 * of its own*: it must never fire while the card already carries an explicit
 * verdict in the §12 vocabulary, or every card that ever spawns unrelated
 * `qa`-owned repair work would be re-read as an open deferral (t_5455942d
 * defect 3). An explicit deferral marker wins over that heuristic — and only
 * over that heuristic: it does not win over a newer verdict.
 */
export function collectDeferral(board, task) {
  // Comments arrive in `created_at` order (loadBoard), so the last match is the
  // newest marker — mirroring how collectVerdicts sorts its sources.
  const markers = (board.commentsByTask.get(task.id) || []).filter((c) => DEFERRAL_RE.test(c.body || ""));
  const marker = markers.length ? markers[markers.length - 1] : null;
  const operativeVerdict = collectVerdicts(board, task).filter((v) => VERDICTS.has(v.token)).pop() || null;
  const linked = board
    .childrenOf(task.id)
    .map((id) => board.taskById.get(id))
    .filter((t) => t && QA_PROFILES.has(String(t.assignee || "").trim()));
  if (!marker) {
    if (operativeVerdict || linked.length === 0) return null;
  } else if (operativeVerdict && Number(operativeVerdict.at || 0) >= Number(marker.created_at || 0)) {
    // Superseded by the verdict recorded at/after it — no live deferral, and no
    // R8 judgement of a marker that no longer governs the card.
    return null;
  }
  const named = ((marker ? marker.body : "").match(TASK_ID_RE) || [])[0] || (linked[0] ? linked[0].id : null);
  return { target: named, marker: Boolean(marker), linked: linked.map((t) => ({ id: t.id, status: t.status })) };
}

/**
 * Evidence pointers. Each pointer carries a `scope`:
 *
 *   claim     — the operative verdict presents it as **its own** evidence
 *               (§5.7: inside an `Evidence:` label, or, without a label,
 *               anywhere outside a code span/fence). Only claims are resolved
 *               by R5.
 *   citation  — named in the operative verdict but not claimed: the verdict is
 *               quoting a path about another card (a defect report, a
 *               cross-check). Reported as A6, never as this card's gap
 *               (t_99e408c5).
 *   history   — a superseded verdict or an earlier handoff named it (t_5455942d
 *               defect 2): reported as A5 at most.
 *
 * `operative` is kept as the boolean projection of `scope === "claim"` so the
 * facts JSON stays readable.
 */
export function collectEvidence(board, task, repoRoot) {
  const pointers = [];
  const rank = { history: 1, citation: 2, claim: 3 };
  const push = (kind, value, origin, scope = "history") => {
    const v = String(value).trim();
    if (!v) return;
    const existing = pointers.find((p) => p.kind === kind && p.value === v);
    if (existing) {
      if (rank[scope] > rank[existing.scope]) {
        existing.scope = scope;
        existing.operative = scope === "claim";
        existing.origin = origin;
      }
      return;
    }
    pointers.push({ kind, value: v, origin, scope, operative: scope === "claim" });
  };

  const verdicts = collectVerdicts(board, task).filter((v) => v.comment);
  const operativeVerdict = verdicts.length ? verdicts[verdicts.length - 1] : null;
  for (const v of verdicts) {
    const isOperative = v === operativeVerdict;
    const text = v.comment;
    // Claimed vs cited is only a question for the operative verdict — an older
    // one is history whatever it named.
    const ranges = isOperative ? codeRanges(text) : [];
    const labelRegions = isOperative ? evidenceLabelRegions(text, ranges) : [];
    const scopeAt = (index) => {
      if (!isOperative) return "history";
      if (labelRegions.length) return insideRanges(index, labelRegions) ? "claim" : "citation";
      return insideRanges(index, ranges) ? "citation" : "claim";
    };
    for (const m of text.matchAll(EVIDENCE_URL_RE)) push("url", m[0], `${v.source}-comment`, scopeAt(m.index));
    for (const m of text.matchAll(EVIDENCE_MD_LINK_RE)) pushClassified(push, m[1], `${v.source}-comment`, scopeAt(m.index + 2));
    for (const m of text.matchAll(EVIDENCE_PATH_RE)) push("path", m[1], `${v.source}-comment`, scopeAt(m.index + m[0].length - m[1].length));
    for (const m of text.matchAll(EVIDENCE_ABS_RE)) push("abs", m[1], `${v.source}-comment`, scopeAt(m.index + m[0].length - m[1].length));
    for (const m of text.matchAll(EVIDENCE_DIR_RE)) {
      push("dir", m[1].replace(/\/$/, ""), `${v.source}-comment`, scopeAt(m.index + m[0].length - m[1].length));
    }
  }
  for (const a of board.attachmentsByTask.get(task.id) || []) {
    push("attachment", a.filename, "attachment", "claim");
    const last = pointers[pointers.length - 1];
    if (last && last.value === a.filename) last.stored_path = a.stored_path;
  }
  for (const r of board.runsByTask.get(task.id) || []) {
    const md = parseJson(r.metadata);
    if (!md) continue;
    const op =
      Boolean(operativeVerdict) &&
      operativeVerdict.source === "run-metadata" &&
      operativeVerdict.runId !== null &&
      String(operativeVerdict.runId) === String(r.id);
    for (const key of ["artifacts", "evidence"]) {
      if (!Array.isArray(md[key])) continue;
      for (const item of md[key]) pushClassified(push, String(item), `run-metadata.${key}`, op ? "claim" : "history");
    }
  }

  for (const p of pointers) {
    if (p.kind === "url") {
      p.exists = null;
      continue;
    }
    if (p.kind === "attachment") {
      p.exists = p.stored_path ? existsSync(p.stored_path) : null;
      continue;
    }
    const abs = p.kind === "abs" || isAbsolute(p.value) ? p.value : repoRoot ? resolve(repoRoot, p.value) : null;
    p.resolved = abs;
    p.exists = abs ? existsSync(abs) : null;
  }
  return pointers;
}

function pushClassified(push, value, origin, scope = "history") {
  const v = String(value).trim();
  if (!v) return;
  if (/^https?:\/\//.test(v)) {
    if (/github\.com\/[\w.-]+\/[\w.-]+\/(actions\/runs\/\d+|pull\/\d+|issues\/\d+)/.test(v)) push("url", v, origin, scope);
    return;
  }
  if (isAbsolute(v)) return push("abs", v, origin, scope);
  const clean = v.replace(/^\.\//, "").split("#")[0];
  if (/\.(md|txt|json|xml|mjs|cjs|ts|tsx|js|html|sarif|log|png|jpg|svg|ya?ml|csv)$/i.test(clean)) return push("path", clean, origin, scope);
  if (/\/(tests|docs|architecture)\//.test(`/${clean}`)) return push("dir", clean.replace(/\/$/, ""), origin, scope);
}

/**
 * Does a repo-relative path exist on **any** ref of the checkout (not just in
 * the worker's working tree)? A card may legitimately cite an artifact that
 * lives on another branch; that is a "committed path" per §5.3, so it must not
 * be reported as missing (t_5455942d defect 2). Returns the commit sha or null.
 */
function findOnAnyRef(repoRoot, relPath) {
  if (!repoRoot || isAbsolute(relPath)) return null;
  if (!existsSync(join(repoRoot, ".git"))) return null;
  try {
    const out = execFileSync("git", ["-C", repoRoot, "rev-list", "--max-count=1", "--all", "--", relPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
    return out ? out.split("\n")[0] : null;
  } catch {
    return null;
  }
}

function hasArchitectSignoff(board, task) {
  return (board.commentsByTask.get(task.id) || []).some(
    (c) => ARCHITECT_PROFILES.has(String(c.author || "").trim()) && ARCH_SIGNOFF_RE.test(c.body || ""),
  );
}

function findException(board, task) {
  const c = (board.commentsByTask.get(task.id) || []).find((x) => EXCEPTION_RE.test(x.body || ""));
  if (!c) return null;
  const m = EXCEPTION_RE.exec(c.body || "");
  return { reason: (m[1] || "").slice(0, 200), author: c.author };
}

/** Rule ids and meanings are documented in QA_SIGN_OFF_GATE.md §4. */
export function evaluateCard(board, task, opts = {}) {
  const repoRoot = opts.repo || null;
  const epochMs = opts.epochMs ?? Date.parse(GATE_EPOCH_ISO);
  const preComplete = Boolean(opts.preComplete);
  const violations = [];
  const advisories = [];
  const add = (rule, detail) => violations.push({ rule, detail });
  const advise = (rule, detail) => advisories.push({ rule, detail });

  const completedMs = task.completed_at ? Number(task.completed_at) * 1000 : null;
  const postEpoch =
    preComplete || task.status !== "done" || (completedMs !== null && completedMs >= epochMs);
  const exception = findException(board, task);

  const verdicts = collectVerdicts(board, task);
  const valid = verdicts.filter((v) => VERDICTS.has(v.token));
  // `deferred` is a legal marker value but not a verdict — §5.4 handles it (R8).
  const invalid = verdicts.filter((v) => v.token && !VERDICTS.has(v.token) && v.token !== "deferred");
  const deferral = collectDeferral(board, task);
  const evidence = collectEvidence(board, task, repoRoot);
  const missingFiles = evidence.filter((p) => p.exists === false);
  // Before the facts are rendered, try to satisfy the operative verdict's
  // missing paths from the repo's other refs: a path committed on another
  // branch is real evidence (§5.3), just not in this worker's checkout.
  const offTree = [];
  for (const p of missingFiles) {
    if (p.kind === "attachment" || p.scope === "history") continue;
    const ref = findOnAnyRef(repoRoot, p.value);
    if (!ref) continue;
    p.exists = true;
    p.viaRef = ref;
    // A *cited* path the repo does hold needs no advisory at all; a claimed one
    // is the accepted off-tree case (A4).
    if (p.scope === "claim") offTree.push(p);
  }

  const facts = {
    task_id: task.id,
    title: task.title,
    assignee: task.assignee,
    status: task.status,
    completed_at: task.completed_at || null,
    post_epoch: postEpoch,
    verdict: valid.length ? valid[valid.length - 1].token : null,
    invalid_verdicts: invalid.map((v) => ({ token: v.token, raw: v.raw, source: v.source })),
    deferral,
    evidence: evidence.map((p) => ({
      kind: p.kind,
      value: p.value,
      exists: p.exists ?? null,
      operative: Boolean(p.operative),
      scope: p.scope,
      via_ref: p.viaRef || null,
      origin: p.origin,
    })),
    exception,
  };

  // R2 — a verdict token outside the §12 vocabulary.
  for (const v of invalid) {
    add(
      "R2_QA_VERDICT_INVALID",
      `verdict "${v.raw}" (${v.source}${v.author ? ` by ${v.author}` : ""}) is not one of: ${[...VERDICTS].join(", ")}`,
    );
  }

  // R1 — a QA verdict, or a resolvable QA deferral, must exist.
  if (exception) {
    advisories.push({ rule: "X1_EXCEPTION", detail: `QA sign-off exception recorded by ${exception.author}: ${exception.reason}` });
  } else if (valid.length === 0 && !deferral) {
    add(
      "R1_QA_VERDICT_MISSING",
      "no QA verdict on the card — add a comment `QA-VERDICT: <pass|pass-with-conditions|fail|blocked>` from the qa profile, or `QA-VERDICT: deferred — t_xxxxxxxx` pointing at a QA-owned child card",
    );
  }

  if (deferral) {
    const target = deferral.target ? board.taskById.get(deferral.target) : null;
    if (deferral.marker && !target) {
      add("R8_DEFERRAL_TARGET_INVALID", `QA deferral must name an existing card id (t_xxxxxxxx); got ${deferral.target ? `"${deferral.target}"` : "nothing"}`);
    } else if (target && !QA_PROFILES.has(String(target.assignee || "").trim())) {
      add("R8_DEFERRAL_TARGET_INVALID", `QA deferral target ${target.id} is assigned to "${target.assignee}", not a QA profile`);
    } else if (target && target.status !== "done") {
      advise("A2_DEFERRAL_OPEN", `QA verdict deferred to ${target.id} (${target.assignee}, status=${target.status}) — audit tracks it until it lands`);
    } else if (target) {
      const childVerdicts = collectVerdicts(board, target).filter((v) => VERDICTS.has(v.token));
      const childEvidence = collectEvidence(board, target, repoRoot);
      if (childVerdicts.length === 0) add("R8_DEFERRAL_TARGET_INVALID", `QA deferral target ${target.id} is done but carries no QA verdict`);
      else if (childEvidence.length === 0) add("R4_EVIDENCE_MISSING", `QA deferral target ${target.id} carries a verdict but no evidence`);
    }
  }

  // R3 — `fail`/`blocked` must not sit on a `done` card.
  const terminalVerdict = valid.length ? valid[valid.length - 1].token : null;
  if (terminalVerdict && TERMINAL_BAD_VERDICTS.has(terminalVerdict) && task.status === "done" && postEpoch) {
    add("R3_VERDICT_NOT_TERMINAL", `card is done but its latest QA verdict is "${terminalVerdict}"`);
  }

  // R4 — evidence must be attached or named.
  if (!exception && evidence.length === 0) {
    add(
      "R4_EVIDENCE_MISSING",
      "no evidence artifact — attach the file (kanban_attach) or name a CI run URL / committed path (e.g. tests/evidence/<task-id>/README.md) in the QA verdict comment; put the path after an `Evidence:` label, which is what marks it as this card's own evidence (§5.7)",
    );
  }

  // R5 — a **claimed** evidence file/directory must exist. Two scopings narrow
  // this, both of them availability fixes rather than relaxations:
  //  * to the **operative** (newest) verdict: a path recorded by a superseded
  //    verdict or an earlier worker's handoff is history and must not make a
  //    compliant card uncompletable (t_5455942d defect 2) — reported as A5;
  //  * to the paths that verdict **claims as its own** (§5.7): a path it merely
  //    quotes about another card — a defect report, a cross-check, a pasted
  //    transcript — is not this card's evidence and is reported as A6
  //    (t_99e408c5: the QA card that reported a broken pointer elsewhere became
  //    uncompletable for naming it).
  // A4 marks the accepted off-tree case; A3 the "cannot verify at all" case.
  const adjudicated = missingFiles.filter((p) => p.exists === false);
  for (const p of adjudicated) {
    if (p.scope === "citation") {
      advise(
        "A6_EVIDENCE_CITED",
        `evidence ${p.value} is only cited in the operative verdict (outside its §5.7 evidence label, or inside a code span) — not claimed as this card's evidence, report only`,
      );
      continue;
    }
    if (p.scope !== "claim") {
      advise("A5_EVIDENCE_SUPERSEDED", `evidence ${p.value} named in a superseded verdict/handoff is absent from this checkout — report only`);
      continue;
    }
    add(
      "R5_EVIDENCE_FILE_MISSING",
      `evidence ${p.kind === "dir" ? "directory" : "file"} claimed by the operative verdict (§5.7) does not exist: ${p.value}${repoRoot ? ` (repo: ${repoRoot}; not found on any ref)` : ""}`,
    );
  }
  for (const p of offTree) {
    advise("A4_EVIDENCE_OFF_TREE", `operative evidence ${p.value} is not in this checkout but exists in the repo at ${p.viaRef} — accepted`);
  }
  if (repoRoot === null) {
    for (const p of evidence.filter((x) => x.exists === null && x.kind !== "url" && x.kind !== "attachment")) {
      advise("A3_EVIDENCE_UNVERIFIED", `evidence path could not be verified (no repo root): ${p.value}`);
    }
  }

  // R6 — `pass-with-conditions` must name its follow-ups.
  if (terminalVerdict === "pass-with-conditions") {
    const text = valid
      .filter((v) => v.token === "pass-with-conditions")
      .map((v) => v.comment || "")
      .join("\n");
    if (!NOTE_FOLLOWUP_RE.test(text)) {
      add("R6_CONDITIONS_UNTRACKED", "pass-with-conditions verdict names no follow-up card id, issue/PR link, or follow-up item");
    }
  }

  // R7 — crypto/bridge/auth cards need the Architect half of the AR-6 sign-off.
  const tt = testTypesOf(task);
  const securityTrack =
    SECURITY_TRACK_RE.test(`${task.title || ""}\n${task.body || ""}`) &&
    /security/.test(tt) &&
    !QA_PROFILES.has(String(task.assignee || "").trim());
  facts.security_track = securityTrack;
  if (securityTrack && postEpoch && !hasArchitectSignoff(board, task) && !exception) {
    add("R7_SECURITY_TRACK_SIGNOFF_MISSING", "crypto/bridge/auth card carries no Architect sign-off comment (AR-6)");
  }

  // A1 — grandfathered cards never produce violations (unless --strict-history):
  // every rule failure is reported as an advisory instead.
  if (!postEpoch) {
    if (!exception) {
      if (valid.length === 0 && !deferral) advise("A1_HISTORY_UNGATED", "completed before the gate epoch — no QA verdict (grandfathered)");
      if (evidence.length === 0) advise("A1_HISTORY_UNGATED", "completed before the gate epoch — no evidence pointer (grandfathered)");
    }
    if (opts.strictHistory) {
      if (valid.length === 0 || evidence.length === 0) {
        add("A1_HISTORY_UNGATED", "--strict-history: pre-epoch card is not compliant");
      }
    } else {
      for (const v of violations) advise("A1_HISTORY_UNGATED", `pre-epoch gap: ${v.rule}`);
      violations.length = 0;
    }
  }

  return { violations, advisories, facts };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

export function defaultDbPath() {
  if (process.env.HERMES_KANBAN_DB) return process.env.HERMES_KANBAN_DB;
  const shared = join(homedir(), ".hermes", "kanban.db");
  if (existsSync(shared)) return shared;
  return join(process.env.HERMES_HOME || join(homedir(), ".hermes"), "kanban.db");
}

function killSwitchPath() {
  const candidates = [
    join(process.env.HERMES_HOME || join(homedir(), ".hermes"), "signoff-gate.disabled"),
    join(homedir(), ".hermes", "signoff-gate.disabled"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

function resolveRepo(argRepo) {
  if (typeof argRepo === "string" && argRepo) return resolve(argRepo);
  const cwd = process.cwd();
  return existsSync(join(cwd, ".git")) ? cwd : null;
}

function renderReport(results, opts, out) {
  const enforced = results.filter((r) => r.facts.post_epoch);
  const history = results.filter((r) => !r.facts.post_epoch);
  const failed = results.filter((r) => r.violations.length > 0);
  const enforcedFailed = enforced.filter((r) => r.violations.length > 0);
  out(`QA sign-off gate — ${opts.mode} (db: ${opts.db}, epoch: ${new Date(opts.epochMs).toISOString()})`);
  out(`  enforced (done at/after epoch or pre-complete): ${enforced.length}  ·  pass: ${enforced.length - enforcedFailed.length}  ·  FAIL: ${enforcedFailed.length}`);
  for (const r of failed) {
    out(`  FAIL ${fmtCard(r.facts)}${r.facts.status !== "done" ? ` [${r.facts.status}]` : ""}`);
    for (const v of r.violations) out(`        ${v.rule}: ${v.detail}`);
    for (const a of r.advisories) if (a.rule !== "A1_HISTORY_UNGATED") out(`        warn ${a.rule}: ${a.detail}`);
  }
  for (const r of enforced.filter((x) => x.violations.length === 0)) {
    out(`  ok   ${fmtCard(r.facts)}`);
    for (const a of r.advisories) if (a.rule !== "A1_HISTORY_UNGATED") out(`        warn ${a.rule}: ${a.detail}`);
  }
  if (history.length) {
    out(`  grandfathered (done before epoch — advisory only): ${history.length}`);
    for (const r of history.slice(0, 10)) {
      const notes = r.advisories.filter((a) => a.rule === "A1_HISTORY_UNGATED").map((a) => a.detail);
      out(`      warn ${r.facts.task_id}  ${notes.join("; ") || "no verdict/evidence recorded"}`);
    }
    if (history.length > 10) out(`      … and ${history.length - 10} more (use --json for the full list)`);
  }
  return failed.length;
}

function fmtCard(facts) {
  return `${facts.task_id}  ${facts.title}${facts.assignee ? ` @${facts.assignee}` : ""}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0] || "audit";
  const db = typeof args.db === "string" && args.db ? args.db : defaultDbPath();
  const repo = resolveRepo(args.repo);
  const epochMs = typeof args["epoch-iso"] === "string" ? Date.parse(args["epoch-iso"]) : Date.parse(GATE_EPOCH_ISO);

  if (mode === "hook") return hookMode(db);

  if (mode === "check" && !(typeof args.task === "string" && args.task)) {
    console.error("signoff-gate: `check` requires --task t_xxxxxxxx");
    process.exit(3);
  }
  if (mode !== "audit" && mode !== "check") {
    console.error(`signoff-gate: unknown mode "${mode}" (expected audit | check | hook)`);
    process.exit(3);
  }

  let board;
  try {
    board = loadBoard(db);
  } catch (e) {
    console.error(`signoff-gate: ${e.message}`);
    process.exit(3);
  }

  if (mode === "check") {
    const task = board.taskById.get(args.task);
    if (!task) {
      console.error(`signoff-gate: task ${args.task} not found in ${db}`);
      process.exit(3);
    }
    const r = evaluateCard(board, task, {
      repo,
      epochMs,
      preComplete: Boolean(args["pre-complete"]),
      strictHistory: Boolean(args["strict-history"]),
    });
    if (args.json) {
      console.log(JSON.stringify({ mode, db, repo, task_id: task.id, ...r }, null, 2));
    } else {
      renderReport([r], { mode: `check ${task.id}${args["pre-complete"] ? " (pre-complete)" : ""}`, db, epochMs }, (s) => console.log(s));
    }
    process.exit(r.violations.length ? 1 : 0);
  }

  const opts = { repo, epochMs, strictHistory: Boolean(args["strict-history"]) };
  const results = board.tasks.filter((t) => t.status === "done").map((t) => evaluateCard(board, t, opts));
  const failures = results.filter((r) => r.violations.length > 0);
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          mode,
          db,
          repo,
          epoch: new Date(epochMs).toISOString(),
          ok: failures.length === 0,
          counts: {
            done_cards: results.length,
            enforced: results.filter((r) => r.facts.post_epoch).length,
            failures: failures.length,
            grandfathered: results.filter((r) => !r.facts.post_epoch).length,
          },
          results,
        },
        null,
        2,
      ),
    );
  } else {
    renderReport(results, { mode, db, epochMs }, (s) => console.log(s));
  }
  process.exit(failures.length ? 1 : 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook mode — pre_tool_call: kanban_complete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the board task id from a `pre_tool_call` payload.
 *
 * Explicit payload sources (first match that is a task-id shape wins):
 *   1. `tool_input.task_id`   — the explicit argument to `kanban_complete`
 *   2. `extra.task_id`        — only when it actually looks like a task id
 *   3. `$HERMES_KANBAN_TASK`  — the dispatcher's identity variable
 * Location fallbacks, used only when the payload carries no usable task id:
 *   4. basename of `$HERMES_KANBAN_WORKSPACE`
 *   5. basename of the hook's `cwd` (the worker's checkout)
 *   6. last path segment of `$HERMES_KANBAN_BRANCH`
 * Every candidate is verified against the board, so a wrong guess cannot evaluate
 * the wrong card.
 *
 * Why the location fallbacks are not paranoia: Hermes scrubs the kanban identity
 * variables (`HERMES_KANBAN_TASK`, `_RUN_ID`, `_CLAIM_LOCK`) out of *descendant*
 * processes (`agent/delegation_context.py::scrub_kanban_env` — a hook subprocess is
 * a descendant), and `extra.task_id` carries the Hermes **session id**, not the
 * card id. So for the natural `kanban_complete()` call the hook sees neither: the
 * pre-fix chain resolved the session id and `fail_closed` turned a compliant
 * completion into a hard block (t_5455942d). Verified with `hook-env-probe.py`.
 */
export function resolveTaskId(payload, board, dbPath) {
  const input = (payload && payload.tool_input) || {};
  const extra = (payload && payload.extra) || {};
  const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  const base = (p) => (p ? p.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "" : "");
  const explicit = [
    { source: "tool_input.task_id", value: str(input.task_id), strict: true },
    { source: "extra.task_id", value: str(extra.task_id), strict: false },
    { source: "HERMES_KANBAN_TASK", value: str(process.env.HERMES_KANBAN_TASK), strict: false },
  ];
  const derived = [
    { source: "HERMES_KANBAN_WORKSPACE", value: base(str(process.env.HERMES_KANBAN_WORKSPACE)) },
    { source: "cwd", value: base(str(payload && payload.cwd)) },
    { source: "HERMES_KANBAN_BRANCH", value: base(str(process.env.HERMES_KANBAN_BRANCH)) },
  ];

  const tried = [];
  for (const c of [...explicit, ...derived]) {
    if (!c.value) {
      tried.push(`${c.source}=<empty>`);
      continue;
    }
    const shown = c.value.length > 64 ? `${c.value.slice(0, 61)}…` : c.value;
    // Numeric id: the dispatcher can hand over a run id — the board itself knows
    // which card that run belongs to, so resolve it from there (never guess).
    if (/^\d+$/.test(c.value) && board.runsById.has(c.value)) {
      const run = board.runsById.get(c.value);
      if (run && board.taskById.has(run.task_id)) return { id: run.task_id, source: `${c.source} (run id ${c.value})` };
    }
    if (!TASK_ID_SHAPE_RE.test(c.value)) {
      const looksSession = /^\d{8}_\d{6}_[0-9a-z]+$/i.test(c.value);
      tried.push(
        `${c.source}="${shown}" (not a task id — expected t_xxxxxxxx${looksSession ? "; this looks like a Hermes session id" : ""})`,
      );
      continue;
    }
    if (board.taskById.has(c.value)) return { id: c.value, source: c.source };
    tried.push(`${c.source}="${shown}" (task-id shape but not on this board)`);
    if (c.strict) {
      return {
        error: `signoff-gate: task ${c.value} (from ${c.source}) is not on the board at ${dbPath}. Failing closed. If the hook picked up the wrong id, re-issue kanban_complete with an explicit task_id="t_xxxxxxxx" (QA_SIGN_OFF_GATE.md §8).`,
      };
    }
  }
  return {
    error:
      `signoff-gate: could not resolve a board task id for this kanban_complete — tried: ${tried.join("; ")}. ` +
      `Failing closed. Re-issue the call with an explicit task_id="t_xxxxxxxx" (QA_SIGN_OFF_GATE.md §8 troubleshooting).`,
  };
}

function hookMode(defaultDb) {
  const allow = () => {
    process.stdout.write("{}\n");
    process.exit(0);
  };
  const block = (reason) => {
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
    process.exit(2);
  };
  const kill = killSwitchPath();
  if (kill) {
    process.stderr.write(`signoff-gate: kill switch active (${kill}) — allowing kanban_complete\n`);
    return allow();
  }
  let payload = {};
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    return block(
      `signoff-gate: could not parse the hook payload (${e.message}). Failing closed — check the card manually: node scripts/qa/signoff-gate.mjs check --task <id> --pre-complete`,
    );
  }
  const tool = payload.tool_name || "";
  if (tool && tool !== "kanban_complete") return allow();
  const db = process.env.HERMES_KANBAN_DB || defaultDb;
  const repo = typeof payload.cwd === "string" && existsSync(payload.cwd) ? payload.cwd : resolveRepo(null);
  let board;
  try {
    board = loadBoard(db);
  } catch (e) {
    return block(`signoff-gate: board unreadable (${e.message}). Failing closed.`);
  }
  const resolved = resolveTaskId(payload, board, db);
  if (resolved.error) return block(resolved.error);
  const taskId = resolved.id;
  const task = board.taskById.get(taskId);
  if (!task) return block(`signoff-gate: task ${taskId} (from ${resolved.source}) is not on the board at ${db}. Failing closed.`);
  let result;
  try {
    result = evaluateCard(board, task, { repo, epochMs: Date.parse(GATE_EPOCH_ISO), preComplete: true });
  } catch (e) {
    return block(`signoff-gate: evaluation error (${e.message}). Failing closed.`);
  }
  if (result.violations.length === 0) return allow();
  const lines = result.violations.map((v) => `  - ${v.rule}: ${v.detail}`);
  return block(
    [
      `QA sign-off gate blocked this completion of ${taskId} (${result.violations.length} violation(s)):`,
      ...lines,
      "Record the verdict on the card, then call kanban_complete again:",
      `  hermes kanban comment ${taskId} --author qa --body "QA-VERDICT: pass — evidence: tests/evidence/${taskId}/README.md"`,
      `Policy: QA_SIGN_OFF_GATE.md · re-check: node scripts/qa/signoff-gate.mjs check --task ${taskId} --pre-complete`,
    ].join("\n"),
  );
}

const invoked = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (invoked) {
  try {
    main();
  } catch (e) {
    const isHook = (process.argv[2] || "") === "hook";
    process.stderr.write(`signoff-gate: internal error: ${e.stack || e.message}\n`);
    if (isHook) {
      process.stdout.write(`${JSON.stringify({ decision: "block", reason: `signoff-gate: internal error — failing closed (${e.message})` })}\n`);
      process.exit(2);
    }
    process.exit(3);
  }
}
