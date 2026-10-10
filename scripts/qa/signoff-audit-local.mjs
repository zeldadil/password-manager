#!/usr/bin/env node
/**
 * signoff-audit-local.mjs — the weekly QA sign-off audit, run LOCALLY on the
 * host that carries the board, reported to the agents through the board
 * (t_8a64c3dd, QA_SIGN_OFF_GATE.md §6.5).
 *
 * Why local: the repository is public, so a self-hosted GitHub runner would let
 * a fork PR execute code on the host (~/.hermes, agent credentials). A hosted
 * runner cannot see ~/.hermes/kanban.db. The board and the host's `gh` login
 * (which can read branch protection, so R10 is evaluated for real) are both
 * here. Architect analysis #632 on t_30d7dff5; Adil's decision 2026-10-09.
 *
 * Two modes.
 *
 *   run          Runs `signoff-gate.mjs audit` (from the same checkout as this
 *                script — a throwaway worktree of origin/master, see
 *                scripts/qa/cron/qa-weekly-signoff-audit.sh) and reports:
 *                  1. the full text + JSON report are ATTACHED to the permanent
 *                     maintenance card ("AUDIT: résultats hebdomadaires du gate");
 *                  2. every card in violation — and every card carrying A11,
 *                     which fails the audit under --fail-on-a11 — gets ONE comment
 *                     `AUDIT <YYYY-MM-DD> : <RULE>, <RULE>` (author `qa`), read by
 *                     the agent that owns the card;
 *                  3. a synthesis comment is posted on the maintenance card,
 *                     LAST, whose first line is the machine-readable stamp
 *                     `AUDIT-RUN: <ISO8601>` (architect, t_8a64c3dd criterion 4).
 *                     A run that could not finish posts `AUDIT-RUN-FAILED: <ISO>`
 *                     instead, which `check-stale` never counts as a run.
 *                It NEVER unblocks, completes, reassigns, or edits a card, and it
 *                sends nothing to Telegram: the only board writes are
 *                `hermes kanban comment` and `hermes kanban attach`.
 *
 *   check-stale  Reads the newest `AUDIT-RUN:` stamp a `qa` comment left on the
 *                maintenance card. Exit 1 (and one line on stdout) when there is
 *                none or it is older than --max-age-days (default 8). This is for
 *                ANOTHER mechanism (architect's review cron): a job that did not
 *                run cannot report its own absence.
 *
 * The per-card comments are inert for the gate, by construction and by test:
 * they carry no `verdict:` / `QA-VERDICT` marker, no sign-off exception key and
 * no `Evidence:`/`Attachment:` label (`assertInertForGate`), and the selftest
 * re-audits the fixture board after posting and requires every card's
 * violation and advisory set to be unchanged.
 *
 * Idempotent per day: a card that already carries the exact same `AUDIT <date>`
 * first line from the same author is skipped (a re-run the same day adds no
 * duplicate), and an attachment name carries the run's timestamp.
 *
 * Usage:
 *   node scripts/qa/signoff-audit-local.mjs run --db PATH --maintenance-card ID
 *        --out-dir DIR [--repo PATH] [--fail-on-a11] [--now-iso ISO]
 *        [--hermes-bin PATH] [--author qa] [--revision-label REF] [--dry-run]
 *   node scripts/qa/signoff-audit-local.mjs check-stale --db PATH
 *        --maintenance-card ID [--max-age-days 8] [--now-iso ISO] [--author qa]
 *
 * `--hermes-bin` (default `hermes`) is the CLI used for the two board writes;
 * the selftest points it at a stub. The CLI is run with HERMES_KANBAN_DB=<--db>
 * so it writes to the board that was audited. Arguments travel as argv arrays,
 * never through a shell.
 *
 * Exit codes — run: 0 = audit ran and every report was posted (whatever the
 * audit found: violations are reported to the cards, they are not an error of
 * this job) · 2 = operational failure (gate crashed / no JSON / a board write
 * failed; an `AUDIT-RUN-FAILED` comment is attempted) · 3 = bad usage.
 * check-stale: 0 = fresh · 1 = missing or stale · 3 = bad usage / unreadable board.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "signoff-gate.mjs");

export const STAMP_PREFIX = "AUDIT-RUN:";
export const FAILED_PREFIX = "AUDIT-RUN-FAILED:";
export const MAINTENANCE_TITLE_PREFIX = "AUDIT: résultats hebdomadaires du gate";
const TASK_ID_RE = /^t_[0-9a-z]+$/;
const RULE_RE = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;
const A11_RULE = "A11_CI_STATE_UNVERIFIABLE";

/**
 * Patterns the gate reads in a `qa` comment (signoff-gate.mjs: VERDICT_MARKER_RE,
 * VERDICT_LOOSE_RE, DEFERRAL_RE, EXCEPTION_RE + withdrawal, EVIDENCE_LABEL_RE).
 * Deliberately broader than the gate's own regexes: an AUDIT comment must not
 * come anywhere near them, so a future loosening of the gate cannot turn an
 * audit notice into a verdict, an exception or an evidence claim.
 */
const GATE_SENSITIVE = [
  /verdict\s*[:\-—–]/i,
  /sign[\s_-]*off[\s_-]*exception/i,
  /(?:^|[^\w])(?:evidence|artifacts?|attachments?)[ \t]*(?::|—|–)/i,
];

export function assertInertForGate(body) {
  for (const re of GATE_SENSITIVE) {
    if (re.test(body)) throw new Error(`audit comment would be read by the gate (${re}): refusing to post it`);
  }
  return body;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (["fail-on-a11", "dry-run"].includes(key)) {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) throw new UsageError(`--${key} needs a value`);
    out[key] = next;
    i++;
  }
  return out;
}

class UsageError extends Error {}

function sqliteJson(db, sql) {
  const out = execFileSync("sqlite3", ["-readonly", "-json", db, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  });
  return out.trim() ? JSON.parse(out) : [];
}

function sqlString(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

export function loadMaintenanceCard(db, id) {
  if (!TASK_ID_RE.test(id)) throw new UsageError(`--maintenance-card: not a task id: ${id}`);
  const rows = sqliteJson(db, `SELECT id, title, status FROM tasks WHERE id = ${sqlString(id)}`);
  if (rows.length !== 1) throw new Error(`maintenance card ${id} not found on ${db}`);
  const card = rows[0];
  if (!String(card.title || "").startsWith(MAINTENANCE_TITLE_PREFIX)) {
    throw new Error(`card ${id} is not the maintenance card (title "${card.title}" does not start with "${MAINTENANCE_TITLE_PREFIX}")`);
  }
  if (["done", "archived"].includes(card.status)) {
    throw new Error(`maintenance card ${id} is ${card.status} — reopen or replace it before the next run`);
  }
  return card;
}

function commentsBy(db, taskId, author) {
  return sqliteJson(
    db,
    `SELECT body, created_at FROM task_comments WHERE task_id = ${sqlString(taskId)} AND author = ${sqlString(author)} ORDER BY created_at, id`,
  );
}

/** ISO-8601 to the second, UTC, `Z` suffix. */
export function isoSeconds(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Per-card findings from the gate's `--json` document: every violation rule
 * (deduplicated, in first-seen order) plus A11 for the `a11_task_ids`.
 * Returns [{ id, assignee, title, rules: [...] }] sorted by card id.
 */
export function cardFindings(doc) {
  const byId = new Map();
  const add = (id, facts, rule) => {
    if (!TASK_ID_RE.test(String(id))) return;
    if (!RULE_RE.test(String(rule))) return;
    if (!byId.has(id)) byId.set(id, { id, assignee: facts?.assignee ?? null, title: facts?.title ?? "", rules: [] });
    const e = byId.get(id);
    if (!e.rules.includes(rule)) e.rules.push(rule);
  };
  const factsById = new Map();
  for (const r of doc.results || []) {
    const f = r.facts || {};
    factsById.set(f.task_id, f);
    for (const v of r.violations || []) add(f.task_id, f, v.rule);
  }
  for (const id of doc.a11_task_ids || []) add(id, factsById.get(id), A11_RULE);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function cardCommentBody({ date, rules, maintenanceId, reportName }) {
  const head = `AUDIT ${date} : ${rules.join(", ")}`;
  const a11Only = rules.length === 1 && rules[0] === A11_RULE;
  const lines = [
    head,
    "",
    "Weekly QA sign-off gate audit, posted automatically by qa (t_8a64c3dd). This notice changes nothing on the card: no status, assignee or record is touched.",
    a11Only
      ? "A11 means the audit could not verify this card's CI state on GitHub (R9/R10 not evaluated). It fails the weekly audit (--fail-on-a11) until the CI state can be read; it is not a defect in the card's own work."
      : "The rules above are the gate's findings for this card as of this run; their meaning is in QA_SIGN_OFF_GATE.md section 4.",
    `Full report: maintenance card ${maintenanceId}, file ${reportName}.`,
  ];
  return assertInertForGate(lines.join("\n"));
}

function n(v) {
  return v === undefined || v === null ? "n/a" : String(v);
}

export function summaryBody({ stamp, gateExit, doc, sha, revisionLabel, db, findings, posted, skipped, reportNames, failOnA11 }) {
  const c = doc.counts || {};
  const deg = new Map((doc.degradations || []).map((d) => [d.key, d]));
  const degLine = (key, label) => {
    const d = deg.get(key);
    if (!d) return `${label} n/a`;
    if (d.available === false) return `${label} not available`;
    return `${label} ${n(d.count)}`;
  };
  const result = gateExit === 0 ? "PASS" : "FAIL";
  const lines = [
    `${STAMP_PREFIX} ${stamp}`,
    `result: ${result} (gate exit ${gateExit}${failOnA11 ? ", --fail-on-a11" : ""})`,
    `revision audited: ${revisionLabel || "checkout"} @ ${sha || "unknown"}`,
    `board: ${db}`,
    `cards: done ${n(c.done_cards)} · enforced ${n(c.enforced)} · FAIL ${n(c.failures)} · grandfathered ${n(c.grandfathered)}`,
    `bypasses & degradations: ${degLine("a11", "A11")} · ${degLine("x1", "X1")} · ${degLine("x2", "X2")} · ${degLine("x3", "X3")}`,
    `card notices: ${posted} posted, ${skipped} already posted for this date`,
    `report files attached to this card: ${reportNames.join(", ")}`,
  ];
  if (findings.length) {
    lines.push("", "cards with findings:");
    for (const f of findings) lines.push(`- ${f.id} (${f.assignee || "unassigned"}): ${f.rules.join(", ")}`);
  } else {
    lines.push("", "cards with findings: none");
  }
  return lines.join("\n");
}

export function failedBody({ stamp, reason }) {
  return [`${FAILED_PREFIX} ${stamp}`, `the weekly audit did not complete: ${reason}`, "This is not a run: check-stale keeps counting from the last AUDIT-RUN stamp."].join("\n");
}

/** Board writes through the Hermes CLI (or a stub), argv only. */
function makeBoardWriter({ hermesBin, db, author, dryRun, log }) {
  const env = { ...process.env, HERMES_KANBAN_DB: db };
  const call = (args) => {
    log.push({ argv: args });
    if (dryRun) return;
    const r = spawnSync(hermesBin, args, { env, encoding: "utf8", timeout: 120000 });
    if (r.error || r.status !== 0) {
      const msg = r.error ? r.error.message : `${(r.stderr || r.stdout || "").trim().split("\n").pop()} (exit ${r.status})`;
      throw new Error(`${hermesBin} ${args.slice(0, 2).join(" ")} failed: ${msg}`);
    }
  };
  return {
    comment: (taskId, body) => call(["kanban", "comment", "--author", author, taskId, body]),
    attach: (taskId, path, name) => call(["kanban", "attach", "--author", author, "--name", name, taskId, path]),
  };
}

function gitHead(repo) {
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function runAudit(args) {
  const db = resolve(need(args, "db"));
  const maintenanceId = need(args, "maintenance-card");
  const outDir = resolve(need(args, "out-dir"));
  const repo = resolve(args.repo || join(HERE, "..", ".."));
  const author = args.author || "qa";
  const hermesBin = args["hermes-bin"] || "hermes";
  const now = args["now-iso"] ? new Date(args["now-iso"]) : new Date();
  if (Number.isNaN(now.getTime())) throw new UsageError(`--now-iso: not an ISO-8601 instant: ${args["now-iso"]}`);
  const stamp = isoSeconds(now);
  const date = stamp.slice(0, 10);
  const fileStamp = stamp.replace(/[-:]/g, "");
  if (!existsSync(db)) throw new UsageError(`--db: no such file: ${db}`);

  loadMaintenanceCard(db, maintenanceId);
  mkdirSync(outDir, { recursive: true });
  const txtName = `qa-signoff-audit-${fileStamp}.txt`;
  const jsonName = `qa-signoff-audit-${fileStamp}.json`;
  const txtPath = join(outDir, txtName);
  const jsonPath = join(outDir, jsonName);

  const log = [];
  const board = makeBoardWriter({ hermesBin, db, author, dryRun: Boolean(args["dry-run"]), log });

  const gateArgs = [GATE, "audit", "--db", db, "--repo", repo, "--json-out", jsonPath];
  if (args["fail-on-a11"]) gateArgs.push("--fail-on-a11");
  if (args["now-iso"]) gateArgs.push("--now-iso", stamp);
  const g = spawnSync(process.execPath, gateArgs, { encoding: "utf8", timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const header = `# ${process.execPath} ${gateArgs.map((a) => (a === GATE ? "scripts/qa/signoff-gate.mjs" : a)).join(" ")}\n# revision ${gitHead(repo) || "unknown"} · run ${stamp} · exit ${g.status}\n\n`;
  writeFileSync(txtPath, header + (g.stdout || "") + (g.stderr ? `\n--- stderr ---\n${g.stderr}` : ""));

  const fail = (reason) => {
    const result = { ok: false, stamp, reason, txtPath, jsonPath, actions: log };
    // Best effort, each write on its own: a failing attach must not swallow the
    // AUDIT-RUN-FAILED notice (and vice versa).
    try {
      if (existsSync(txtPath)) board.attach(maintenanceId, txtPath, txtName);
    } catch (e) {
      result.reason += ` · the report could not be attached: ${e.message}`;
    }
    try {
      board.comment(maintenanceId, failedBody({ stamp, reason: result.reason }));
    } catch (e) {
      result.reason += ` · and the failure notice could not be posted: ${e.message}`;
    }
    return result;
  };

  let doc = null;
  if (g.error) return fail(`the gate did not run: ${g.error.message}`);
  if (g.status !== 0 && g.status !== 1) return fail(`the gate exited ${g.status} (expected 0 or 1)`);
  try {
    doc = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (e) {
    return fail(`no readable --json-out document: ${e.message}`);
  }
  if (doc.mode !== "audit" || !Array.isArray(doc.results)) return fail("the --json-out document is not an audit report");

  const findings = cardFindings(doc);
  let posted = 0;
  let skipped = 0;
  try {
    board.attach(maintenanceId, txtPath, txtName);
    board.attach(maintenanceId, jsonPath, jsonName);
    for (const f of findings) {
      const body = cardCommentBody({ date, rules: f.rules, maintenanceId, reportName: txtName });
      const head = body.split("\n")[0];
      if (commentsBy(db, f.id, author).some((c) => String(c.body || "").split("\n")[0] === head)) {
        skipped++;
        continue;
      }
      board.comment(f.id, body);
      posted++;
    }
    board.comment(
      maintenanceId,
      summaryBody({
        stamp,
        gateExit: g.status,
        doc,
        sha: gitHead(repo),
        revisionLabel: args["revision-label"] || null,
        db,
        findings,
        posted,
        skipped,
        reportNames: [txtName, jsonName],
        failOnA11: Boolean(args["fail-on-a11"]),
      }),
    );
  } catch (e) {
    return fail(`board write failed after ${posted} card notice(s): ${e.message}`);
  }
  return { ok: true, stamp, gateExit: g.status, findings, posted, skipped, txtPath, jsonPath, actions: log };
}

export function checkStale(args) {
  const db = resolve(need(args, "db"));
  const maintenanceId = need(args, "maintenance-card");
  const author = args.author || "qa";
  const maxDays = args["max-age-days"] === undefined ? 8 : Number(args["max-age-days"]);
  if (!Number.isFinite(maxDays) || maxDays <= 0) throw new UsageError(`--max-age-days: not a positive number: ${args["max-age-days"]}`);
  const now = args["now-iso"] ? new Date(args["now-iso"]) : new Date();
  if (Number.isNaN(now.getTime())) throw new UsageError(`--now-iso: not an ISO-8601 instant: ${args["now-iso"]}`);
  if (!existsSync(db)) throw new UsageError(`--db: no such file: ${db}`);
  loadMaintenanceCard(db, maintenanceId);
  let last = null;
  for (const c of commentsBy(db, maintenanceId, author)) {
    const first = String(c.body || "").split("\n")[0].trim();
    if (!first.startsWith(STAMP_PREFIX)) continue;
    const t = new Date(first.slice(STAMP_PREFIX.length).trim());
    if (Number.isNaN(t.getTime())) continue;
    if (!last || t > last) last = t;
  }
  const ageDays = last ? (now - last) / 86400000 : null;
  const stale = !last || ageDays > maxDays;
  return { stale, last: last ? isoSeconds(last) : null, ageDays, maxDays, maintenanceId };
}

function need(args, key) {
  const v = args[key];
  if (v === undefined || v === true || v === "") throw new UsageError(`--${key} is required`);
  return v;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    const mode = args._[0];
    if (mode === "run") {
      const r = runAudit(args);
      if (args["dry-run"]) console.log(JSON.stringify({ ...r, findings: undefined }, null, 2));
      if (!r.ok) {
        console.error(`signoff-audit-local: FAILED (${r.stamp}): ${r.reason}`);
        process.exit(2);
      }
      const fails = r.findings.length;
      console.log(`signoff-audit-local: ${STAMP_PREFIX} ${r.stamp} · gate exit ${r.gateExit} · ${fails} card(s) with findings · ${r.posted} notice(s) posted, ${r.skipped} already posted · report ${r.txtPath}`);
      process.exit(0);
    }
    if (mode === "check-stale") {
      const r = checkStale(args);
      if (r.stale) {
        console.log(`AUDIT MISSING: no ${STAMP_PREFIX} stamp on ${r.maintenanceId} newer than ${r.maxDays} days (last: ${r.last || "never"}${r.ageDays !== null ? `, ${r.ageDays.toFixed(1)} days ago` : ""})`);
        process.exit(1);
      }
      console.log(`AUDIT OK: last ${STAMP_PREFIX} ${r.last} (${r.ageDays.toFixed(1)} days ago, limit ${r.maxDays})`);
      process.exit(0);
    }
    throw new UsageError("usage: signoff-audit-local.mjs run|check-stale [options] — see the header");
  } catch (e) {
    console.error(`signoff-audit-local: ${e.message}`);
    process.exit(e instanceof UsageError ? 3 : args && args._[0] === "check-stale" ? 3 : 2);
  }
}

const invoked = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (invoked) main();
