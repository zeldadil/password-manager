#!/usr/bin/env node
/**
 * secret-guard.selftest.mjs — SEC-001 / T_B51A1FF3 non-vacuity proof for
 * scripts/qa/secret-guard.mjs
 *
 * Builds throwaway Kanban boards (SQLite) in a temp dir, seeds compliant and
 * non-compliant payloads, runs the gate as a subprocess in every mode
 * (hook / check / audit) and asserts:
 *
 *   - a payload containing a Telegram bot token shape is blocked (block + exit 2)
 *   - a payload containing key=value secret pair is blocked
 *   - a payload containing an AWS key id is blocked
 *   - a clean / compliant payload is allowed ({} + exit 0)
 *   - check mode exits 1 on a secret, 0 on clean text
 *   - audit mode exits 0 on clean board, 1 on a board with a secret in a comment
 *   - the kill switch allows the call
 *   - a malformed payload fails closed (block + exit 2)
 *   - tools not in the guarded set pass through
 *
 * Exit 0 = all cases pass · exit 1 = a case failed (printed with detail).
 *
 * Usage: node scripts/qa/secret-guard.selftest.mjs [--keep]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = join(dirname(fileURLToPath(import.meta.url)));
const GATE = join(HERE, "secret-guard.mjs");
const KEEP = process.argv.includes("--keep");

const root = mkdtempSync(join(tmpdir(), "secret-guard-selftest-"));
const db = join(root, "board.db");
const cleanDb = join(root, "clean.db");
const repo = join(root, "repo");

// ── Realistic Telegram bot token shape (35 chars after colon) ───────────────
// Synthetic fixture only — never the real bot id or token. Shape: NNNNNNNN:<35 chars>.
// The guard rule matches the shape, not a specific id.
const SYNTH_TOKEN = "1111222222:" + "A".repeat(35);

// ── fixture boards ────────────────────────────────────────────────────────────

const BOARD_SQL = `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT,
  completed_at INTEGER, created_at INTEGER
);
CREATE TABLE task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT, body TEXT, created_at INTEGER
);
CREATE TABLE task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT, status TEXT, outcome TEXT,
  summary TEXT, metadata TEXT, started_at INTEGER, ended_at INTEGER
);
`;

let seq = 0xb0000000;
function nextId() {
  return `t_${(seq++).toString(16).padStart(8, "0")}`;
}

// Board with a comment containing a Telegram bot token shape
const TOKEN_TASK = nextId();
// Board with a comment containing a key=value secret pair
const KEYVAL_TASK = nextId();
// Board with a comment containing an AWS key id
const AWS_TASK = nextId();
// Clean board — no secret-shaped comments at all
const CLEAN_TASK = nextId();

const now = Math.floor(Date.now() / 1000);

const dirtyBoardSQL = [
  BOARD_SQL,
  `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${TOKEN_TASK}','token card','**Test Types:** unit','backend','done',${now},${now-1000});`,
  `INSERT INTO task_comments (task_id,author,body,created_at) VALUES ('${TOKEN_TASK}','dashboard','deployment done — bot token ${SYNTH_TOKEN} is live',${now});`,
  `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${KEYVAL_TASK}','keyval card','**Test Types:** unit','backend','done',${now},${now-1000});`,
  `INSERT INTO task_comments (task_id,author,body,created_at) VALUES ('${KEYVAL_TASK}','architect','API key=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',${now});`,
  `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${AWS_TASK}','aws card','**Test Types:** unit','backend','done',${now},${now-1000});`,
  `INSERT INTO task_comments (task_id,author,body,created_at) VALUES ('${AWS_TASK}','backend','deployed with AKIA1234567890ABCDEF',${now});`,
].join("\n");

const cleanBoardSQL = [
  BOARD_SQL,
  `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${CLEAN_TASK}','clean card','**Test Types:** unit','backend','done',${now},${now-1000});`,
  `INSERT INTO task_comments (task_id,author,body,created_at) VALUES ('${CLEAN_TASK}','qa','QA-VERDICT: pass — evidence: tests/evidence/${CLEAN_TASK}/README.md',${now});`,
  `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${nextId()}','another clean','**Test Types:** unit','backend','done',${now},${now-1000});`,
  `INSERT INTO task_comments (task_id,author,body,created_at) VALUES ('${nextId()}','qa','deployment successful — no issues',${now});`,
].join("\n");

execFileSync("sqlite3", [db], { input: dirtyBoardSQL });
execFileSync("sqlite3", [cleanDb], { input: cleanBoardSQL });

// ── harness ──────────────────────────────────────────────────────────────────

const failures = [];
let cases = 0;

function runGate(args, input, env = {}) {
  try {
    const out = execFileSync("node", [GATE, ...args], {
      encoding: "utf8",
      input: input ?? "",
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

function check(name, condition, detail = "") {
  cases++;
  if (condition) {
    console.log(`  ok   - ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function parseDirective(out) {
  try {
    return JSON.parse(out.split("\n")[0]);
  } catch {
    return null;
  }
}

// ── run ──────────────────────────────────────────────────────────────────────

console.log(`secret-guard selftest — fixture board: ${db}`);
console.log(`clean board: ${cleanDb}`);
console.log(`fixture repo: ${repo}`);

console.log("\n1. Hook mode — pre_tool_call: kanban_comment / kanban_create / kanban_complete");

// Block: kanban_comment with a Telegram bot token
// Hermes wire shape: tool_name + args (the tool input dict) at top level.
const tokenPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_comment",
  args: { task_id: TOKEN_TASK, body: `deployment done — bot token ${SYNTH_TOKEN} is live` },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
});
const tokenBlocked = runGate(["hook", "--db", db], tokenPayload, { HERMES_KANBAN_DB: db, HERMES_HOME: repo });
const tokenDir = parseDirective(tokenBlocked.out);
check(
  "kanban_comment with Telegram bot token → block + exit 2",
  tokenBlocked.code === 2 && tokenDir && tokenDir.decision === "block" && tokenDir.reason.includes("R_SECRET_TELEGRAM_BOT_TOKEN"),
  `exit=${tokenBlocked.code} directive=${JSON.stringify(tokenDir).slice(0, 200)}`,
);

// Block: kanban_comment with key=value pair
const keyvalPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_comment",
  args: { task_id: KEYVAL_TASK, body: "API key=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
});
const keyvalBlocked = runGate(["hook", "--db", db], keyvalPayload, { HERMES_KANBAN_DB: db, HERMES_HOME: repo });
const keyvalDir = parseDirective(keyvalBlocked.out);
check(
  "kanban_comment with key=value secret → block + exit 2",
  keyvalBlocked.code === 2 && keyvalDir && keyvalDir.decision === "block" && keyvalDir.reason.includes("R_SECRET_KEY_VALUE_PAIR"),
  `exit=${keyvalBlocked.code} directive=${JSON.stringify(keyvalDir).slice(0, 200)}`,
);

// Block: kanban_comment with AWS key id
const awsPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_comment",
  args: { task_id: AWS_TASK, body: "deployed with AKIA0123456789ABCDEF" },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
});
const awsBlocked = runGate(["hook", "--db", db], awsPayload, { HERMES_KANBAN_DB: db, HERMES_HOME: repo });
const awsDir = parseDirective(awsBlocked.out);
check(
  "kanban_comment with AWS key id → block + exit 2",
  awsBlocked.code === 2 && awsDir && awsDir.decision === "block" && awsDir.reason.includes("R_SECRET_AWS_ACCESS_KEY_ID"),
  `exit=${awsBlocked.code} directive=${JSON.stringify(awsDir).slice(0, 200)}`,
);

// Allow: clean kanban_comment
const cleanCommentPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_comment",
  args: { task_id: CLEAN_TASK, body: "QA-VERDICT: pass — evidence: tests/evidence/clean/README.md" },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
});
const cleanCommentAllowed = runGate(["hook", "--db", cleanDb], cleanCommentPayload, { HERMES_KANBAN_DB: cleanDb, HERMES_HOME: repo });
check(
  "clean kanban_comment → {} + exit 0",
  cleanCommentAllowed.code === 0 && cleanCommentAllowed.out.trim() === "{}",
  `exit=${cleanCommentAllowed.code} out=${cleanCommentAllowed.out.trim().slice(0, 120)}`,
);

// Allow: kanban_create with clean body
const cleanCreatePayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_create",
  args: { title: "new task", body: "some clean description" },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
});
const cleanCreateAllowed = runGate(["hook", "--db", cleanDb], cleanCreatePayload, { HERMES_KANBAN_DB: cleanDb, HERMES_HOME: repo });
check(
  "clean kanban_create → {} + exit 0",
  cleanCreateAllowed.code === 0 && cleanCreateAllowed.out.trim() === "{}",
  `exit=${cleanCreateAllowed.code} out=${cleanCreateAllowed.out.trim().slice(0, 120)}`,
);

// Allow: kanban_complete with clean summary
const cleanDoneTask = nextId();
execFileSync("sqlite3", [cleanDb], {
  input: `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${cleanDoneTask}','done task','**Test Types:** unit','backend','done',${now},${now-1000});`,
});
const cleanCompletePayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_complete",
  args: { task_id: cleanDoneTask, summary: "all tests pass" },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
  extra: { task_id: cleanDoneTask },
});
const cleanCompleteAllowed = runGate(["hook", "--db", cleanDb], cleanCompletePayload, { HERMES_KANBAN_DB: cleanDb, HERMES_HOME: repo });
check(
  "clean kanban_complete → {} + exit 0",
  cleanCompleteAllowed.code === 0 && cleanCompleteAllowed.out.trim() === "{}",
  `exit=${cleanCompleteAllowed.code} out=${cleanCompleteAllowed.out.trim().slice(0, 120)}`,
);

// Block: kanban_complete with a token in the summary
const badDoneTask = nextId();
execFileSync("sqlite3", [db], {
  input: `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${badDoneTask}','bad done','**Test Types:** unit','backend','done',${now},${now-1000});`,
});
const badCompletePayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_complete",
  args: { task_id: badDoneTask, summary: `done — token ${SYNTH_TOKEN}` },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
  extra: { task_id: badDoneTask },
});
const badCompleteBlocked = runGate(["hook", "--db", db], badCompletePayload, { HERMES_KANBAN_DB: db, HERMES_HOME: repo });
const badCompleteDir = parseDirective(badCompleteBlocked.out);
check(
  "kanban_complete with Telegram bot token in summary → block + exit 2",
  badCompleteBlocked.code === 2 && badCompleteDir && badCompleteDir.decision === "block" && badCompleteDir.reason.includes("R_SECRET_TELEGRAM_BOT_TOKEN"),
  `exit=${badCompleteBlocked.code} directive=${JSON.stringify(badCompleteDir).slice(0, 200)}`,
);

// Block: kanban_complete with a token in the result field (D2 fix)
const badResultTask = nextId();
execFileSync("sqlite3", [db], {
  input: `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${badResultTask}','bad result','**Test Types:** unit','backend','done',${now},${now-1000});`,
});
const badResultPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_complete",
  args: { task_id: badResultTask, summary: "all tests pass", result: `done with bot token ${SYNTH_TOKEN}` },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
  extra: { task_id: badResultTask },
});
const badResultBlocked = runGate(["hook", "--db", db], badResultPayload, { HERMES_KANBAN_DB: db, HERMES_HOME: repo });
const badResultDir = parseDirective(badResultBlocked.out);
check(
  "kanban_complete with Telegram bot token in result → block + exit 2 (D2)",
  badResultBlocked.code === 2 && badResultDir && badResultDir.decision === "block" && badResultDir.reason.includes("R_SECRET_TELEGRAM_BOT_TOKEN"),
  `exit=${badResultBlocked.code} directive=${JSON.stringify(badResultDir).slice(0, 200)}`,
);

// Block: kanban_complete with a token in the top-level artifacts array (D2 fix)
const badArtifactsTask = nextId();
execFileSync("sqlite3", [db], {
  input: `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${badArtifactsTask}','bad artifacts','**Test Types:** unit','backend','done',${now},${now-1000});`,
});
const badArtifactsPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_complete",
  args: { task_id: badArtifactsTask, summary: "done", artifacts: ["tests/evidence/t_b0000001/proof.txt", `bot token ${SYNTH_TOKEN} leaked`] },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
  extra: { task_id: badArtifactsTask },
});
const badArtifactsBlocked = runGate(["hook", "--db", db], badArtifactsPayload, { HERMES_KANBAN_DB: db, HERMES_HOME: repo });
const badArtifactsDir = parseDirective(badArtifactsBlocked.out);
check(
  "kanban_complete with Telegram bot token in top-level artifacts → block + exit 2 (D2)",
  badArtifactsBlocked.code === 2 && badArtifactsDir && badArtifactsDir.decision === "block" && badArtifactsDir.reason.includes("R_SECRET_TELEGRAM_BOT_TOKEN"),
  `exit=${badArtifactsBlocked.code} directive=${JSON.stringify(badArtifactsDir).slice(0, 200)}`,
);

// Block: kanban_request_review with token in summary (A5 widening)
const reviewTask = nextId();
execFileSync("sqlite3", [db], {
  input: `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${reviewTask}','review task','**Test Types:** unit','backend','done',${now},${now-1000});`,
});
const reviewPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_request_review",
  args: { task_id: reviewTask, summary: `requesting review — bot token ${SYNTH_TOKEN} in summary` },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
  extra: { task_id: reviewTask },
});
const reviewBlocked = runGate(["hook", "--db", db], reviewPayload, { HERMES_KANBAN_DB: db, HERMES_HOME: repo });
const reviewDir = parseDirective(reviewBlocked.out);
check(
  "kanban_request_review with Telegram bot token in summary → block + exit 2 (A5)",
  reviewBlocked.code === 2 && reviewDir && reviewDir.decision === "block" && reviewDir.reason.includes("R_SECRET_TELEGRAM_BOT_TOKEN"),
  `exit=${reviewBlocked.code} directive=${JSON.stringify(reviewDir).slice(0, 200)}`,
);

// Block: kanban_block with token in reason (A5 widening)
const blockTask = nextId();
const blockPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_block",
  args: { task_id: blockTask, reason: `blocked due to bot token ${SYNTH_TOKEN} in reason` },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
  extra: { task_id: blockTask },
});
const blockBlocked = runGate(["hook", "--db", db], blockPayload, { HERMES_KANBAN_DB: db, HERMES_HOME: repo });
const blockDir = parseDirective(blockBlocked.out);
check(
  "kanban_block with Telegram bot token in reason → block + exit 2 (A5)",
  blockBlocked.code === 2 && blockDir && blockDir.decision === "block" && blockDir.reason.includes("R_SECRET_TELEGRAM_BOT_TOKEN"),
  `exit=${blockBlocked.code} directive=${JSON.stringify(blockDir).slice(0, 200)}`,
);

// Block: kanban_request_changes with token in reason (A5 widening)
const changesTask = nextId();
const changesPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "kanban_request_changes",
  args: { task_id: changesTask, reason: `changes requested — bot token ${SYNTH_TOKEN} in reason` },
  session_id: "sess_fixture",
  cwd: repo,
  profile: "backend",
  extra: { task_id: changesTask },
});
const changesBlocked = runGate(["hook", "--db", db], changesPayload, { HERMES_KANBAN_DB: db, HERMES_HOME: repo });
const changesDir = parseDirective(changesBlocked.out);
check(
  "kanban_request_changes with Telegram bot token in reason → block + exit 2 (A5)",
  changesBlocked.code === 2 && changesDir && changesDir.decision === "block" && changesDir.reason.includes("R_SECRET_TELEGRAM_BOT_TOKEN"),
  `exit=${changesBlocked.code} directive=${JSON.stringify(changesDir).slice(0, 200)}`,
);

// Pass-through: other tool (terminal)
const terminalPayload = JSON.stringify({
  hook_event_name: "pre_tool_call",
  tool_name: "terminal",
  args: { command: "ls" },
  session_id: "sess_fixture",
});
const terminalPass = runGate(["hook", "--db", cleanDb], terminalPayload, { HERMES_KANBAN_DB: cleanDb, HERMES_HOME: repo });
check(
  "terminal tool passes through (not guarded)",
  terminalPass.code === 0 && terminalPass.out.trim() === "{}",
  `exit=${terminalPass.code} out=${terminalPass.out.trim().slice(0, 120)}`,
);

// Malformed payload — must use direct `node` invocation because `hermes hooks test`
// always serialises valid JSON; the parse-fail path is only reachable with a raw invalid
// payload on stdin (the production failure mode the guard protects against).
const brokenRaw = "{not json";
const brokenBlocked = runGate(["hook", "--db", cleanDb], brokenRaw, { HERMES_KANBAN_DB: cleanDb, HERMES_HOME: repo });
const brokenDir = parseDirective(brokenBlocked.out);
check(
  "malformed payload → fail closed (block + exit 2, R_SECRET_PARSE_ERROR)",
  brokenBlocked.code === 2 && brokenDir && brokenDir.decision === "block" && brokenDir.reason.includes("R_SECRET_PARSE_ERROR"),
  `exit=${brokenBlocked.code} directive=${JSON.stringify(brokenDir).slice(0, 200)}`,
);

// Kill switch
const kill = join(root, "secret-guard.disabled");
writeFileSync(kill, "temporarily disabled by operator\n");
const killed = runGate(["hook", "--db", db], tokenPayload, { HERMES_KANBAN_DB: db, HERMES_HOME: root });
check(
  "kill switch allows the call",
  killed.code === 0 && killed.out.trim() === "{}",
  `exit=${killed.code} out=${killed.out.trim().slice(0, 120)}`,
);
rmSync(kill, { force: true });

console.log("\n2. Check mode — one-shot text scan");

const cleanCheck = runGate(["check"], "hello world, this is a clean comment\n");
check("check mode: clean text → exit 0", cleanCheck.code === 0, `exit=${cleanCheck.code}`);

const tokenCheck = runGate(["check"], `deployment done — bot token ${SYNTH_TOKEN} is live\n`);
check("check mode: text with Telegram bot token → exit 1", tokenCheck.code === 1, `exit=${tokenCheck.code}`);

const keyvalCheck = runGate(["check"], "API key=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n");
check("check mode: text with key=value secret → exit 1", keyvalCheck.code === 1, `exit=${keyvalCheck.code}`);

const awsCheck = runGate(["check"], "deployed with AKIA1234567890ABCDEF\n");
check("check mode: text with AWS key id → exit 1", awsCheck.code === 1, `exit=${awsCheck.code}`);

console.log("\n3. Audit mode — whole-board scan");

const auditClean = runGate(["audit", "--db", cleanDb]);
check("audit mode: clean board → exit 0", auditClean.code === 0, `exit=${auditClean.code} out=${auditClean.out.trim().slice(0, 200)}`);

const auditHit = runGate(["audit", "--db", db]);
check("audit mode: board with a secret in a comment → exit 1", auditHit.code === 1, `exit=${auditHit.code}`);

console.log(`\n${cases - failures.length}/${cases} cases passed`);
if (failures.length) {
  console.log("\nFAILED CASES:");
  for (const f of failures) console.log(`  - ${f}`);
  if (!KEEP) rmSync(root, { recursive: true, force: true });
  process.exit(1);
}
if (!KEEP) rmSync(root, { recursive: true, force: true });
process.exit(0);
