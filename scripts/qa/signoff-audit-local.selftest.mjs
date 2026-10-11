#!/usr/bin/env node
/**
 * signoff-audit-local.selftest.mjs — selftest of the local weekly audit reporter
 * (t_8a64c3dd, scripts/qa/signoff-audit-local.mjs, QA_SIGN_OFF_GATE.md §6.5).
 *
 * Zero npm dependencies (node + sqlite3, like the gate). Builds a synthetic
 * board (gate-selftest schema), a fixture repo, and a stub `hermes` CLI that
 * writes comments/attachments into the fixture board and logs every call, then
 * runs the REAL gate audit through the reporter. Never touches ~/.hermes and
 * never calls GitHub (QA_GATE_GITHUB=off).
 *
 * Usage: node scripts/qa/signoff-audit-local.selftest.mjs [--keep]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertInertForGate, cardCommentBody, cardFindings, STAMP_PREFIX } from "./signoff-audit-local.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, "signoff-audit-local.mjs");
const GATE = join(HERE, "signoff-gate.mjs");
const KEEP = process.argv.includes("--keep");

const root = mkdtempSync(join(tmpdir(), "signoff-audit-local-selftest-"));
const db = join(root, "board.db");
const repo = join(root, "repo");
const out = join(root, "out");
const callsLog = join(root, "hermes-calls.jsonl");
const stub = join(root, "hermes-stub.mjs");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sqlite = (q) => execFileSync("sqlite3", [db, q], { encoding: "utf8" });
const rows = (q) => {
  const o = execFileSync("sqlite3", ["-json", db, q], { encoding: "utf8" }).trim();
  return o ? JSON.parse(o) : [];
};

// ── fixture board ───────────────────────────────────────────────────────────
sqlite(`
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT, completed_at INTEGER, created_at INTEGER);
CREATE TABLE task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
CREATE TABLE task_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, filename TEXT, stored_path TEXT, content_type TEXT, size INTEGER, uploaded_by TEXT, created_at INTEGER);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, summary TEXT, metadata TEXT, started_at INTEGER, ended_at INTEGER);
CREATE TABLE task_links (parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id));
CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL);
`);
const POST_GATE = 1789660000; // 2026-09-17T15:46:40Z — after the gate epoch, before the R9 epoch
const POST_R9 = 1791300000; // 2026-10-06T15:20:00Z — after the R9/R10 epoch
const MAINT = "t_f00000aa";
const MAINT_EMPTY = "t_f00000ab";
const VIOLATING = "t_f0000001";
const COMPLIANT = "t_f0000002";
const A11_CARD = "t_f0000003";
const card = (id, title, body, assignee, status, completed) =>
  sqlite(`INSERT INTO tasks VALUES (${sql(id)}, ${sql(title)}, ${sql(body)}, ${sql(assignee)}, ${sql(status)}, ${completed ?? "NULL"}, ${POST_GATE - 3600});`);
const comment = (id, author, body, at) => sqlite(`INSERT INTO task_comments (task_id, author, body, created_at) VALUES (${sql(id)}, ${sql(author)}, ${sql(body)}, ${at});`);
const run = (id, profile, at) =>
  sqlite(`INSERT INTO task_runs (task_id, profile, status, outcome, summary, metadata, started_at, ended_at) VALUES (${sql(id)}, ${sql(profile)}, 'done', 'completed', 'done', NULL, ${at - 60}, ${at});`);

card(MAINT, "AUDIT: résultats hebdomadaires du gate", "maintenance card (fixture)", "qa", "triage", null);
card(MAINT_EMPTY, "AUDIT: résultats hebdomadaires du gate (no stamp yet)", "fixture", "qa", "triage", null);
card(VIOLATING, "BE-990a done without a QA verdict", "**Test Types:** unit", "backend", "done", POST_GATE);
run(VIOLATING, "backend", POST_GATE);
card(COMPLIANT, "BE-990b compliant card", "**Test Types:** unit", "backend", "done", POST_GATE);
run(COMPLIANT, "backend", POST_GATE);
comment(COMPLIANT, "qa", `QA-VERDICT: pass — evidence: tests/evidence/${COMPLIANT}/README.md`, POST_GATE - 60);
card(A11_CARD, "BE-990c code card, CI state unreadable", "**Test Types:** unit\n**Deliverable:** code", "frontend", "done", POST_R9);
run(A11_CARD, "frontend", POST_R9);
comment(A11_CARD, "qa", `QA-VERDICT: pass — evidence: tests/evidence/${A11_CARD}/README.md`, POST_R9 - 60);
for (const id of [COMPLIANT, A11_CARD]) {
  mkdirSync(join(repo, "tests", "evidence", id), { recursive: true });
  writeFileSync(join(repo, "tests", "evidence", id, "README.md"), "synthetic evidence fixture — no real data\n");
}

// ── stub hermes CLI: writes into the fixture board, logs argv ───────────────
writeFileSync(
  stub,
  `#!/usr/bin/env node
import { appendFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsLog)}, JSON.stringify({ argv, db: process.env.HERMES_KANBAN_DB }) + "\\n");
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (process.env.STUB_FAIL === argv[1]) { console.error("stub: forced failure"); process.exit(1); }
const now = Math.floor(Date.now() / 1000);
if (argv[0] === "kanban" && argv[1] === "comment") {
  const [, , id, body] = pos;
  execFileSync("sqlite3", [process.env.HERMES_KANBAN_DB, "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (" + q(id) + "," + q(opt("--author")) + "," + q(body) + "," + now + ")"]);
} else if (argv[0] === "kanban" && argv[1] === "attach") {
  const [, , id, path] = pos;
  execFileSync("sqlite3", [process.env.HERMES_KANBAN_DB, "INSERT INTO task_attachments (task_id, filename, stored_path, size, uploaded_by, created_at) VALUES (" + q(id) + "," + q(opt("--name")) + "," + q(path) + "," + statSync(path).size + "," + q(opt("--author")) + "," + now + ")"]);
} else { console.error("stub: unexpected command " + argv.join(" ")); process.exit(9); }
`,
);
chmodSync(stub, 0o755);

const ENV = { ...process.env, QA_GATE_GITHUB: "off" };
delete ENV.QA_GATE_GITHUB_FIXTURE;
function tool(args, extraEnv = {}) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", env: { ...ENV, ...extraEnv } });
}
function calls() {
  return existsSync(callsLog) ? readFileSync(callsLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}
function gateAudit() {
  const r = spawnSync(process.execPath, [GATE, "audit", "--db", db, "--repo", repo, "--json"], { encoding: "utf8", env: ENV });
  const doc = JSON.parse(r.stdout);
  return Object.fromEntries(
    doc.results.map((x) => [x.facts.task_id, JSON.stringify({ v: x.violations.map((v) => v.rule).sort(), a: x.advisories.map((a) => a.rule).sort() })]),
  );
}
const commentsOn = (id) => rows(`SELECT author, body FROM task_comments WHERE task_id = ${sql(id)} ORDER BY id`);
const stateSnapshot = () => JSON.stringify(rows("SELECT id, status, assignee, title, body, completed_at FROM tasks ORDER BY id"));

console.log(`signoff-audit-local selftest — fixture root: ${root}`);

// ── 1. unit: the comment guard and the findings extraction ─────────────────
console.log("1. unit");
for (const bad of ["QA-VERDICT: pass", "verdict: fail", "Verdict — pass", "qa-signoff-exception: x", "qa sign-off exception — y", "Evidence: tests/evidence/x/README.md", "attachment: a.txt", "Artifacts — x"]) {
  let threw = false;
  try {
    assertInertForGate(`AUDIT 2026-10-12 : R1_QA_VERDICT_MISSING\n${bad}`);
  } catch {
    threw = true;
  }
  check(`guard refuses a gate-readable comment: ${JSON.stringify(bad)}`, threw);
}
const allRules = ["R1_QA_VERDICT_MISSING", "R2_QA_VERDICT_INVALID", "R3_VERDICT_NOT_TERMINAL", "R4_EVIDENCE_MISSING", "R5_EVIDENCE_FILE_MISSING", "R6_CONDITIONS_UNTRACKED", "R7_ARCHITECT_SIGNOFF_MISSING", "R8_DEFERRAL_INVALID", "R9_PR_NOT_MERGED", "R10_MERGE_CI_NOT_GREEN", "A11_CI_STATE_UNVERIFIABLE"];
let bodyOk = true;
for (const r of allRules) {
  try {
    cardCommentBody({ date: "2026-10-12", rules: [r], maintenanceId: MAINT, reportName: "qa-signoff-audit-x.txt" });
  } catch {
    bodyOk = false;
  }
}
try {
  cardCommentBody({ date: "2026-10-12", rules: allRules, maintenanceId: MAINT, reportName: "qa-signoff-audit-x.txt" });
} catch {
  bodyOk = false;
}
check("every rule id (alone and all together) yields a comment the guard accepts", bodyOk);
const f = cardFindings({
  results: [
    { facts: { task_id: "t_00000001", assignee: "architect" }, violations: [{ rule: "R2_QA_VERDICT_INVALID" }, { rule: "R2_QA_VERDICT_INVALID" }, { rule: "R4_EVIDENCE_MISSING" }] },
    { facts: { task_id: "t_00000002", assignee: "docs" }, violations: [] },
    { facts: { task_id: "not-an-id; rm -rf", assignee: "x" }, violations: [{ rule: "R1_QA_VERDICT_MISSING" }] },
    { facts: { task_id: "t_00000004", assignee: "x" }, violations: [{ rule: "R1 $(touch /tmp/pwn)" }] },
  ],
  a11_task_ids: ["t_00000002", "t_00000001"],
});
check(
  "findings: rules deduplicated, A11 added, malformed card id / rule dropped",
  JSON.stringify(f.map((x) => [x.id, x.rules])) ===
    JSON.stringify([
      ["t_00000001", ["R2_QA_VERDICT_INVALID", "R4_EVIDENCE_MISSING", "A11_CI_STATE_UNVERIFIABLE"]],
      ["t_00000002", ["A11_CI_STATE_UNVERIFIABLE"]],
    ]),
  JSON.stringify(f),
);

// ── 2. negative control: a violating card gets its AUDIT notice ─────────────
console.log("2. run on the fixture board (--fail-on-a11, GitHub off)");
const before = gateAudit();
const stateBefore = stateSnapshot();
check("precondition: the fixture has a violating card, an A11 card and a compliant card", before[VIOLATING].includes('"R1_QA_VERDICT_MISSING"') && before[A11_CARD].includes("A11_CI_STATE_UNVERIFIABLE") && before[COMPLIANT] === JSON.stringify({ v: [], a: [] }), JSON.stringify(before));
const NOW = "2026-10-12T06:17:00Z";
const r1 = tool(["run", "--db", db, "--repo", repo, "--maintenance-card", MAINT, "--out-dir", out, "--fail-on-a11", "--now-iso", NOW, "--hermes-bin", stub, "--revision-label", "origin/master"]);
check("run exits 0 (findings are reported, not an error of the job)", r1.status === 0, r1.stderr + r1.stdout);
const vComments = commentsOn(VIOLATING);
check(
  "violating card: exactly one qa comment `AUDIT 2026-10-12 : R1_QA_VERDICT_MISSING, R4_EVIDENCE_MISSING`",
  vComments.length === 1 && vComments[0].author === "qa" && vComments[0].body.split("\n")[0] === "AUDIT 2026-10-12 : R1_QA_VERDICT_MISSING, R4_EVIDENCE_MISSING",
  JSON.stringify(vComments),
);
const aComments = commentsOn(A11_CARD).filter((c) => c.body.startsWith("AUDIT "));
check("A11 card: one comment `AUDIT 2026-10-12 : A11_CI_STATE_UNVERIFIABLE`", aComments.length === 1 && aComments[0].body.split("\n")[0] === "AUDIT 2026-10-12 : A11_CI_STATE_UNVERIFIABLE", JSON.stringify(aComments));
check("compliant card: no AUDIT comment", commentsOn(COMPLIANT).every((c) => !c.body.startsWith("AUDIT")));
const mComments = commentsOn(MAINT);
const summary = mComments[mComments.length - 1]?.body || "";
check("maintenance card: synthesis comment whose FIRST line is `AUDIT-RUN: 2026-10-12T06:17:00Z`", summary.split("\n")[0] === `${STAMP_PREFIX} ${NOW}`, summary);
check("synthesis: result FAIL (gate exit 1, --fail-on-a11) and both cards listed", /result: FAIL \(gate exit 1, --fail-on-a11\)/.test(summary) && summary.includes(`- ${VIOLATING} (backend): R1_QA_VERDICT_MISSING, R4_EVIDENCE_MISSING`) && summary.includes(`- ${A11_CARD} (frontend): A11_CI_STATE_UNVERIFIABLE`), summary);
check("synthesis names the audited revision as the wrapper passed it (fixture repo: no git → unknown sha)", summary.includes("revision audited: origin/master @ unknown"), summary);
const att = rows(`SELECT filename, stored_path, uploaded_by FROM task_attachments WHERE task_id = ${sql(MAINT)} ORDER BY id`);
check("maintenance card: the full text report and the JSON report are attached, by qa", att.length === 2 && att[0].filename === "qa-signoff-audit-20261012T061700Z.txt" && att[1].filename === "qa-signoff-audit-20261012T061700Z.json" && att.every((a) => a.uploaded_by === "qa"), JSON.stringify(att));
const reportText = readFileSync(att[0].stored_path, "utf8");
check("attached text report is the real gate audit output (header + FAIL line for the violating card)", reportText.includes("QA sign-off gate — audit") && reportText.includes(VIOLATING) && reportText.includes("R1_QA_VERDICT_MISSING"), reportText.slice(0, 400));
const c1 = calls();
check("the job only ever calls `hermes kanban comment` / `hermes kanban attach` (no complete/unblock/assign/edit, no send)", c1.length > 0 && c1.every((c) => c.argv[0] === "kanban" && ["comment", "attach"].includes(c.argv[1])), JSON.stringify(c1.map((c) => c.argv.slice(0, 2))));
check("every write carries --author qa and targets the audited board (HERMES_KANBAN_DB)", c1.every((c) => c.argv[c.argv.indexOf("--author") + 1] === "qa" && c.db === db));
check("synthesis is posted LAST (the stamp means the run finished)", c1[c1.length - 1].argv[1] === "comment" && c1[c1.length - 1].argv.includes(MAINT));
check("no card status / assignee / title / body changed", stateSnapshot() === stateBefore);
const after = gateAudit();
check("gate-inert: every card's violation and advisory set is identical after the AUDIT comments", JSON.stringify(after) === JSON.stringify(before), `before ${JSON.stringify(before)}\nafter  ${JSON.stringify(after)}`);

// ── 3. idempotence ──────────────────────────────────────────────────────────
console.log("3. idempotence");
const r2 = tool(["run", "--db", db, "--repo", repo, "--maintenance-card", MAINT, "--out-dir", out, "--fail-on-a11", "--now-iso", "2026-10-12T09:00:00Z", "--hermes-bin", stub]);
check("same-day re-run exits 0 and adds no duplicate card notice", r2.status === 0 && commentsOn(VIOLATING).length === 1 && commentsOn(A11_CARD).filter((c) => c.body.startsWith("AUDIT ")).length === 1, r2.stderr + r2.stdout);
check("…and its synthesis says `0 posted, 2 already posted for this date`", commentsOn(MAINT).pop().body.includes("card notices: 0 posted, 2 already posted for this date"));
const r3 = tool(["run", "--db", db, "--repo", repo, "--maintenance-card", MAINT, "--out-dir", out, "--fail-on-a11", "--now-iso", "2026-10-19T06:17:00Z", "--hermes-bin", stub]);
check("next week's run posts a new notice on the still-violating card", r3.status === 0 && commentsOn(VIOLATING).length === 2 && commentsOn(VIOLATING)[1].body.startsWith("AUDIT 2026-10-19 : "), r3.stderr);

// ── 4. missed-run detection (check-stale) ───────────────────────────────────
console.log("4. check-stale");
const stale = (now, id = MAINT, extra = []) => tool(["check-stale", "--db", db, "--maintenance-card", id, "--now-iso", now, ...extra]);
let s = stale("2026-10-20T06:17:00Z");
check("fresh stamp (1 day old) → exit 0 `AUDIT OK`", s.status === 0 && s.stdout.startsWith("AUDIT OK: last AUDIT-RUN: 2026-10-19T06:17:00Z"), s.stdout + s.stderr);
s = stale("2026-10-27T06:17:01Z");
check("negative control: stamp older than 8 days → exit 1 `AUDIT MISSING`", s.status === 1 && s.stdout.startsWith("AUDIT MISSING:") && s.stdout.includes("last: 2026-10-19T06:17:00Z"), s.stdout + s.stderr);
s = stale("2026-10-27T06:17:00Z");
check("boundary: exactly 8 days → still OK", s.status === 0, s.stdout);
s = stale("2026-10-20T00:00:00Z", MAINT_EMPTY);
check("negative control: maintenance card with no stamp at all → exit 1 (last: never)", s.status === 1 && s.stdout.includes("last: never"), s.stdout + s.stderr);
comment(MAINT_EMPTY, "architect", `${STAMP_PREFIX} 2026-10-19T00:00:00Z`, POST_R9);
comment(MAINT_EMPTY, "qa", "AUDIT-RUN-FAILED: 2026-10-19T00:00:00Z\nthe weekly audit did not complete: x", POST_R9);
comment(MAINT_EMPTY, "qa", `quoted, not a stamp: ${STAMP_PREFIX} 2026-10-19T00:00:00Z`, POST_R9);
s = stale("2026-10-20T00:00:00Z", MAINT_EMPTY);
check("a stamp written by another profile, a FAILED stamp and a quoted stamp are not runs → still exit 1", s.status === 1 && s.stdout.includes("last: never"), s.stdout);
s = stale("2026-10-20T00:00:00Z", VIOLATING);
check("check-stale refuses a card that is not the maintenance card (exit 3)", s.status === 3, s.stderr);

// ── 5. failure paths ────────────────────────────────────────────────────────
console.log("5. failure paths");
const nCalls = calls().length;
let r = tool(["run", "--db", db, "--repo", repo, "--maintenance-card", VIOLATING, "--out-dir", out, "--hermes-bin", stub]);
check("run refuses a maintenance card id that is not the maintenance card: exit 2, nothing written", r.status === 2 && calls().length === nCalls, r.stderr);
r = tool(["run", "--db", db, "--repo", repo, "--maintenance-card", "t_deadbeef", "--out-dir", out, "--hermes-bin", stub]);
check("run on a missing maintenance card: exit 2, nothing written", r.status === 2 && calls().length === nCalls, r.stderr);
r = tool(["run", "--db", db, "--repo", repo, "--out-dir", out, "--hermes-bin", stub]);
check("missing --maintenance-card: usage exit 3", r.status === 3, r.stderr);
const stampsBefore = commentsOn(MAINT).filter((c) => c.body.startsWith(STAMP_PREFIX)).length;
r = tool(["run", "--db", db, "--repo", repo, "--maintenance-card", MAINT, "--out-dir", out, "--fail-on-a11", "--now-iso", "2026-10-26T06:17:00Z", "--hermes-bin", stub], { STUB_FAIL: "attach" });
check("a board write that fails → exit 2, and NO `AUDIT-RUN:` stamp is written", r.status === 2 && commentsOn(MAINT).filter((c) => c.body.startsWith(STAMP_PREFIX)).length === stampsBefore, r.stderr);
check("…an `AUDIT-RUN-FAILED:` notice is posted instead", commentsOn(MAINT).pop().body.startsWith("AUDIT-RUN-FAILED: 2026-10-26T06:17:00Z"));
r = tool(["run", "--db", db, "--repo", repo, "--maintenance-card", MAINT, "--out-dir", out, "--now-iso", "2026-10-27T06:17:00Z", "--hermes-bin", join(root, "no-such-hermes")]);
check("hermes CLI missing → exit 2 (never a silent success)", r.status === 2, r.stderr);
const n2 = calls().length;
r = tool(["run", "--db", db, "--repo", repo, "--maintenance-card", MAINT, "--out-dir", out, "--now-iso", "2026-11-02T06:17:00Z", "--hermes-bin", stub, "--dry-run"]);
check("--dry-run: exit 0, plans the writes, performs none", r.status === 0 && calls().length === n2 && JSON.parse(r.stdout.slice(0, r.stdout.lastIndexOf("}") + 1)).actions.length >= 3, r.stderr + r.stdout.slice(0, 300));

console.log(`\n${passed} passed, ${failed} failed`);
if (!KEEP) rmSync(root, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
