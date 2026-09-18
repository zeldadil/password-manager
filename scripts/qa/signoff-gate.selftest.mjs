#!/usr/bin/env node
/**
 * signoff-gate.selftest.mjs — QA-001h non-vacuity proof for scripts/qa/signoff-gate.mjs
 *
 * Builds a throwaway Kanban board (SQLite) in a temp dir, seeds one card per
 * rule in QA_SIGN_OFF_GATE.md §4, runs the gate as a subprocess in every mode
 * (audit / check / hook) and asserts:
 *
 *   - every rule R1–R8 fires on its non-compliant card, with the right rule id;
 *   - every compliant control card produces ZERO violations (proves the rules
 *     are not "always fire");
 *   - the hook emits the exact block directive and exit code 2, allows a
 *     compliant card, honours the kill switch, and fails closed on a broken
 *     payload / unreadable board.
 *
 * Exit 0 = all cases pass · exit 1 = a case failed (printed with detail).
 *
 * Usage: node scripts/qa/signoff-gate.selftest.mjs [--keep]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "signoff-gate.mjs");
const KEEP = process.argv.includes("--keep");

const EPOCH_AFTER = 1789660000; // 2026-09-17T15:46:40Z — post-epoch
const EPOCH_BEFORE = 1789600000; // 2026-09-17T00:26:40Z — pre-epoch control

const root = mkdtempSync(join(tmpdir(), "signoff-gate-selftest-"));
const db = join(root, "board.db");
const repo = join(root, "repo");

// ── fixture repo: evidence files the compliant cards point at ────────────────
function fixtureFile(rel) {
  const p = join(repo, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "synthetic evidence fixture — no real data\n");
}

// ── fixture board ───────────────────────────────────────────────────────────
const BOARD_SQL = `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT,
  completed_at INTEGER, created_at INTEGER
);
CREATE TABLE task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT, body TEXT, created_at INTEGER
);
CREATE TABLE task_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, filename TEXT, stored_path TEXT,
  content_type TEXT, size INTEGER, uploaded_by TEXT, created_at INTEGER
);
CREATE TABLE task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT, status TEXT, outcome TEXT,
  summary TEXT, metadata TEXT, started_at INTEGER, ended_at INTEGER
);
CREATE TABLE task_links (parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id));
`;

const CARDS = [];
let seq = 0xb0000000;
function card({ id, title, body = "", assignee = "backend", status = "done", completed = EPOCH_AFTER, comments = [], runs = [], attachments = [] }) {
  const tid = id || `t_${(seq++).toString(16).padStart(8, "0")}`;
  CARDS.push({ tid, title, body, assignee, status, completed, comments, runs, attachments });
  return tid;
}

const qaVerdict = (body, author = "qa") => ({ author, body });

// ── Path A: verdict + evidence ──────────────────────────────────────────────
const OK = card({
  title: "BE-900a compliant card",
  body: "**Test Types:** unit",
  comments: [qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md")],
});
fixtureFile(`tests/evidence/${OK}/README.md`);

const ARCH_SIGNED = card({
  title: "BE-900b crypto sign-off complete",
  body: "**Test Types:** unit, security\nTouches packages/crypto vault key handling.",
  comments: [
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md"),
    { author: "architect", body: "AR-6 review — signed off on the key-wrapping change." },
  ],
});
fixtureFile(`tests/evidence/${ARCH_SIGNED}/README.md`);

const ATTACHED = card({
  title: "BE-900c evidence uploaded as an attachment",
  body: "**Test Types:** integration",
  comments: [qaVerdict("QA-VERDICT: pass — attachment: coverage-summary.txt")],
  attachments: [{ filename: "coverage-summary.txt", stored_path: join(repo, "attachments", "coverage-summary.txt") }],
});
mkdirSync(join(repo, "attachments"), { recursive: true });
writeFileSync(join(repo, "attachments", "coverage-summary.txt"), "synthetic coverage fixture\n");

const QA_OWN = card({
  title: "QA-900a QA-owned artifact card (run metadata verdict)",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [],
  runs: [
    {
      profile: "qa",
      status: "done",
      outcome: "completed",
      metadata: JSON.stringify({
        verdict: "pass",
        artifacts: ["https://github.com/zeldadil/password-manager/actions/runs/4242424242"],
      }),
    },
  ],
});

const DEFERRED_DONE = card({
  title: "BE-900d deferral to a completed QA child",
  body: "**Test Types:** unit",
  comments: [],
  runs: [
    {
      profile: "backend",
      status: "done",
      outcome: "completed",
      metadata: JSON.stringify({ artifacts: ["https://github.com/zeldadil/password-manager/actions/runs/111"] }),
    },
  ],
});
const DEFERRED_CHILD_DONE = card({
  title: "QA-900b QA child card",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md")],
});
fixtureFile(`tests/evidence/${DEFERRED_CHILD_DONE}/README.md`);

const DEFERRED_OPEN = card({
  title: "BE-900e deferral to an open QA child",
  body: "**Test Types:** unit",
  comments: [],
  runs: [
    {
      profile: "backend",
      status: "done",
      outcome: "completed",
      metadata: JSON.stringify({ artifacts: ["https://github.com/zeldadil/password-manager/actions/runs/222"] }),
    },
  ],
});
const DEFERRED_CHILD_OPEN = card({
  title: "QA-900c QA child card (still to do)",
  body: "**Test Types:** meta",
  assignee: "qa",
  status: "todo",
  completed: null,
});

const CONDITIONAL_TRACKED = card({
  title: "BE-900f pass-with-conditions naming its follow-up",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict(
      "QA-VERDICT: pass-with-conditions — evidence: https://github.com/zeldadil/password-manager/actions/runs/1234567890\nFollow-up: t_0000000a tracks the missing negative case.",
    ),
  ],
});

const PRE_EPOCH = card({
  title: "BE-900g grandfathered card",
  body: "**Test Types:** unit",
  completed: EPOCH_BEFORE,
});

const EXCEPTION = card({
  title: "BE-900h approved exception",
  body: "**Test Types:** unit",
  comments: [qaVerdict("qa-signoff-exception: hotfix under incident INC-001, QA verdict waived for 24h")],
});

// ── Path B: violations ──────────────────────────────────────────────────────
const NO_VERDICT = card({ title: "BE-901 no QA verdict and no evidence", body: "**Test Types:** unit" });

const BAD_VERDICT_FIXTURE = card({
  title: "BE-902 verdict token outside the vocabulary",
  body: "**Test Types:** unit",
  comments: [qaVerdict("QA-VERDICT: green — evidence: tests/evidence/x/README.md")],
});

const FAIL_ON_DONE = card({
  title: "BE-903 fail verdict left on a done card",
  body: "**Test Types:** unit",
  comments: [qaVerdict("QA-VERDICT: fail — evidence: https://github.com/zeldadil/password-manager/actions/runs/1")],
});

const BLOCKED_ON_DONE = card({
  title: "BE-904 blocked verdict left on a done card",
  body: "**Test Types:** unit",
  comments: [qaVerdict("QA-VERDICT: blocked — waiting on the DB — evidence: https://github.com/zeldadil/password-manager/actions/runs/1")],
});

const NO_EVIDENCE = card({
  title: "BE-905 verdict but no evidence",
  body: "**Test Types:** unit",
  comments: [qaVerdict("QA-VERDICT: pass — all suites green.")],
});

const MISSING_FILE = card({
  title: "BE-906 evidence file does not exist",
  body: "**Test Types:** unit",
  comments: [qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/does-not-exist.txt")],
});

const UNTRACKED_CONDITIONS = card({
  title: "BE-907 pass-with-conditions with no follow-up",
  body: "**Test Types:** unit",
  comments: [qaVerdict("QA-VERDICT: pass-with-conditions — evidence: https://github.com/zeldadil/password-manager/actions/runs/2")],
});

const SEC_NO_ARCH = card({
  title: "BE-908 crypto card without AR-6 sign-off",
  body: "**Test Types:** unit, security\nImplements the packages/crypto AEAD wrapper and vault key loading.",
  comments: [qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md")],
});
fixtureFile(`tests/evidence/${SEC_NO_ARCH}/README.md`);

const DEFER_NON_QA = card({
  title: "BE-909 deferral points at a non-QA card",
  body: "**Test Types:** unit",
  comments: [qaVerdict(`QA-VERDICT: deferred — ${OK}`)],
});

const DEFER_PHANTOM = card({
  title: "BE-910 deferral points at a card that does not exist",
  body: "**Test Types:** unit",
  comments: [qaVerdict("QA-VERDICT: deferred — t_deadbeef")],
});

// ── t_58280940 regression fixtures ──────────────────────────────────────────
// A stale `QA-VERDICT: deferred — t_...` marker must not outlive the QA verdict
// that supersedes it: §3 of QA_SIGN_OFF_GATE.md — "When several sources exist,
// the newest one is the operative verdict". Before the fix the gate collected
// the OLDEST deferral marker and evaluated R8 on it unconditionally, so a card
// that had already recorded its verdict stayed permanently uncompletable.
const STALE_DEFERRAL = card({
  title: "BE-915 stale deferral marker, QA verdict recorded afterwards",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: `QA-VERDICT: deferred — ${OK} (waiting on the gate)` },
    {
      author: "dashboard",
      body: "@qa check this ticket please : QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md",
    },
  ],
});
fixtureFile(`tests/evidence/${STALE_DEFERRAL}/README.md`);

const STALE_DEFERRAL_OPEN_CHILD = card({
  title: "BE-916 stale deferral marker to an open QA child + later verdict",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict(`QA-VERDICT: deferred — ${DEFERRED_CHILD_OPEN}`),
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md"),
  ],
});
fixtureFile(`tests/evidence/${STALE_DEFERRAL_OPEN_CHILD}/README.md`);

// Non-vacuity control: superseding is ordered, not blanket amnesty — when the
// deferral is the NEWEST record, R8 must still judge it.
const FRESH_DEFERRAL_NON_QA = card({
  title: "BE-917 verdict first, then a NEWER deferral to a non-QA card",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md"),
    qaVerdict(`QA-VERDICT: deferred — ${OK}`),
  ],
});
fixtureFile(`tests/evidence/${FRESH_DEFERRAL_NON_QA}/README.md`);

// A marker that only appears inside a code span is documentation (a handoff
// quoting the recording command, a troubleshooting transcript like the one
// frontend posted on t_f49d448c) — it is not a live deferral and must not be
// judged by R8, nor hijack the newest-marker ordering.
const QUOTED_DEFERRAL = card({
  title: "BE-918 a comment that only QUOTES the marker is not a deferral",
  body: "**Test Types:** unit",
  comments: [
    {
      author: "architect",
      body: `Handoff — this card records no verdict of its own yet; the gate suggests \`QA-VERDICT: deferred — ${OK}\` if the QA review moves to ${OK}.`,
    },
  ],
});

const STALE_DEFERRAL_QUOTED = card({
  title: "BE-919 real deferral marker, a later comment quotes it, then the verdict lands",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict(`QA-VERDICT: deferred — ${OK}`),
    {
      author: "frontend",
      body: `Blocked by R8_DEFERRAL_TARGET_INVALID against the marker \`QA-VERDICT: deferred — ${OK}\` (comment above) — routing it to qa as a gate defect.`,
    },
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md"),
  ],
});
fixtureFile(`tests/evidence/${STALE_DEFERRAL_QUOTED}/README.md`);

// ── t_5455942d regression fixtures ──────────────────────────────────────────
// The operative (newest) verdict is the only one whose evidence paths R5
// resolves; superseded verdicts/handoffs must not block a compliant card.
const SUPERSEDED_MISSING = card({
  title: "BE-911 operative verdict fine, superseded comments name missing artifacts",
  body: "**Test Types:** unit",
  comments: [
    {
      author: "architect",
      body: "Handoff — record it as\n`QA-VERDICT: pass — evidence: tests/evidence/__ID__/gone-architect.md` and complete the card.",
    },
    qaVerdict("QA-VERDICT: fail — evidence: tests/evidence/__ID__/gone-old-verdict.md\nSuperseded by the verdict recorded below."),
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md"),
  ],
});
fixtureFile(`tests/evidence/${SUPERSEDED_MISSING}/README.md`);

const OPERATIVE_MISSING = card({
  title: "BE-912 operative verdict names a missing artifact (R5 must still fire)",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md"),
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/retracted-file.md"),
  ],
});
fixtureFile(`tests/evidence/${OPERATIVE_MISSING}/README.md`);

const REF_ONLY = card({
  title: "BE-913 operative evidence exists on another ref of the repo only",
  body: "**Test Types:** unit",
  comments: [qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/ref-only.md")],
});

const DEFER_SUPPRESSED = card({
  title: "BE-914 explicit verdict + linked qa child is NOT a deferral",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict(
      "QA-VERDICT: pass-with-conditions — evidence: tests/evidence/__ID__/README.md\nFollow-up: t_0000000a tracks the residual item.",
    ),
  ],
});
fixtureFile(`tests/evidence/${DEFER_SUPPRESSED}/README.md`);
const DEFER_SUPPRESSED_CHILD = card({
  title: "QA-914b qa-owned repair child (unrelated to a verdict)",
  body: "**Test Types:** meta",
  assignee: "qa",
  status: "todo",
  completed: null,
});

// ── fixture git repo: evidence committed on an earlier ref (A4 case) ────────
const gitRepo = join(root, "gitrepo");
const refOnlyRel = `tests/evidence/${REF_ONLY}/ref-only.md`;
function gitFixture(args) {
  execFileSync("git", ["-C", gitRepo, ...args], { stdio: ["ignore", "pipe", "pipe"] });
}
mkdirSync(gitRepo, { recursive: true });
gitFixture(["init", "-q", "-b", "main"]);
gitFixture(["config", "user.email", "fixture@example.invalid"]);
gitFixture(["config", "user.name", "gate fixture"]);
writeFileSync(join(gitRepo, "README.md"), "fixture repo\n");
mkdirSync(dirname(join(gitRepo, refOnlyRel)), { recursive: true });
writeFileSync(join(gitRepo, refOnlyRel), "evidence committed on the branch (not in the tip)\n");
gitFixture(["add", "-A"]);
gitFixture(["commit", "-qm", "add the evidence artifact"]);
rmSync(join(gitRepo, refOnlyRel));
gitFixture(["add", "-A"]);
gitFixture(["commit", "-qm", "remove it from the working tip — still reachable on the branch history"]);

function taskRowSQL(c) {
  const esc = (s) => String(s).replace(/'/g, "''");
  const rows = [
    `INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('${c.tid}','${esc(c.title)}','${esc(c.body)}','${esc(c.assignee)}','${c.status}',${c.completed === null || c.completed === undefined ? "NULL" : c.completed},${EPOCH_BEFORE});`,
  ];
  for (const [i, cm] of c.comments.entries()) {
    const body = String(cm.body).replace(/__ID__/g, c.tid);
    rows.push(
      `INSERT INTO task_comments (task_id,author,body,created_at) VALUES ('${c.tid}','${esc(cm.author)}','${esc(body)}',${EPOCH_AFTER + i});`,
    );
  }
  for (const a of c.attachments || []) {
    rows.push(
      `INSERT INTO task_attachments (task_id,filename,stored_path,content_type,size,uploaded_by,created_at) VALUES ('${c.tid}','${esc(a.filename)}','${esc(a.stored_path)}','text/plain',10,'qa',${EPOCH_AFTER});`,
    );
  }
  for (const r of c.runs || []) {
    const md = JSON.stringify(r.metadata ? JSON.parse(r.metadata) : {}).replace(/t_00000000/g, c.tid).replace(/'/g, "''");
    rows.push(
      `INSERT INTO task_runs (task_id,profile,status,outcome,summary,metadata,started_at,ended_at) VALUES ('${c.tid}','${esc(r.profile)}','${esc(r.status)}','${esc(r.outcome)}','handoff summary','${md}',${EPOCH_AFTER},${EPOCH_AFTER + 5});`,
    );
  }
  return rows.join("\n");
}

function buildBoard() {
  const sql = [
    BOARD_SQL,
    ...CARDS.map(taskRowSQL),
    `INSERT INTO task_links (parent_id,child_id) VALUES ('${DEFERRED_DONE}','${DEFERRED_CHILD_DONE}');`,
    `INSERT INTO task_links (parent_id,child_id) VALUES ('${DEFERRED_OPEN}','${DEFERRED_CHILD_OPEN}');`,
    `INSERT INTO task_links (parent_id,child_id) VALUES ('${DEFER_SUPPRESSED}','${DEFER_SUPPRESSED_CHILD}');`,
  ].join("\n");
  execFileSync("sqlite3", [db], { input: sql });
}

// ── harness ─────────────────────────────────────────────────────────────────
const failures = [];
let cases = 0;

function runGate(args, input, env = {}) {
  try {
    const out = execFileSync("node", [GATE, ...args], {
      encoding: "utf8",
      input: input ?? "",
      // Hermetic: never let the ambient kanban identity/location variables of the
      // host running the selftest leak into a case (t_5455942d).
      env: {
        ...process.env,
        HERMES_KANBAN_TASK: "",
        HERMES_KANBAN_WORKSPACE: "",
        HERMES_KANBAN_BRANCH: "",
        ...env,
      },
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

/** `check ... --json` through the gate, parsed. */
function gateJson(taskId, repoOverride = repo) {
  const r = runGate(["check", "--task", taskId, "--db", db, "--repo", repoOverride, "--json"]);
  let parsed = null;
  try {
    parsed = JSON.parse(r.out);
  } catch {
    parsed = null;
  }
  return { code: r.code, out: r.out, parsed };
}

function advisoryRules(res) {
  return res.parsed ? res.parsed.advisories.map((a) => a.rule) : [];
}

function violationRules(res) {
  return res.parsed ? res.parsed.violations.map((v) => v.rule) : [];
}

function expectRule(label, taskId, rule, { preComplete = false, forbid = [] } = {}) {
  const args = ["check", "--task", taskId, "--db", db, "--repo", repo, "--json"];
  if (preComplete) args.push("--pre-complete");
  const r = runGate(args);
  let parsed = null;
  try {
    parsed = JSON.parse(r.out);
  } catch {
    parsed = null;
  }
  const rules = parsed ? parsed.violations.map((v) => v.rule) : [];
  check(
    `${label} → ${rule}`,
    r.code === 1 && rules.includes(rule) && forbid.every((f) => !rules.includes(f)),
    `exit=${r.code} rules=[${rules.join(",")}] out=${r.out.slice(0, 200).replace(/\n/g, " ")}`,
  );
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log(`QA sign-off gate selftest — fixture board: ${db}`);
console.log(`fixture repo: ${repo}`);
buildBoard();

console.log("\n1. Compliant cards (must produce ZERO violations — anti-vacuous control):");
for (const [label, tid, repoOverride] of [
  ["Path A verdict + repo evidence", OK],
  ["crypto card with AR-6 architect sign-off", ARCH_SIGNED],
  ["evidence uploaded as attachment", ATTACHED],
  ["QA-owned card with run-metadata verdict", QA_OWN],
  ["deferral to a completed QA child", DEFERRED_DONE],
  ["deferral to an open QA child (advisory only)", DEFERRED_OPEN],
  ["pass-with-conditions naming a follow-up", CONDITIONAL_TRACKED],
  ["grandfathered pre-epoch card", PRE_EPOCH],
  ["recorded QA sign-off exception", EXCEPTION],
  ["superseded comments name missing artifacts", SUPERSEDED_MISSING],
  ["operative evidence committed on another ref", REF_ONLY, gitRepo],
  ["explicit verdict + linked qa repair child", DEFER_SUPPRESSED],
  ["stale deferral marker + newer QA verdict (t_58280940)", STALE_DEFERRAL],
  ["stale deferral marker to an open QA child + newer verdict", STALE_DEFERRAL_OPEN_CHILD],
  ["quoted deferral marker later in the thread + verdict (t_58280940)", STALE_DEFERRAL_QUOTED],
]) {
  const res = gateJson(tid, repoOverride || repo);
  check(
    label,
    res.code === 0 && res.parsed !== null && violationRules(res).length === 0,
    `exit=${res.code} rules=[${violationRules(res).join(",")}] out=${res.out.slice(0, 160).replace(/\n/g, " ")}`,
  );
}

console.log("\n1b. t_5455942d regressions (fail closed only on unverifiable input):");
{
  const sup = gateJson(SUPERSEDED_MISSING);
  check(
    "superseded verdict/handoff paths are advisory (A5), never R5",
    sup.code === 0 && advisoryRules(sup).includes("A5_EVIDENCE_SUPERSEDED") && !advisoryRules(sup).includes("A4_EVIDENCE_OFF_TREE"),
    `exit=${sup.code} adv=[${advisoryRules(sup).join(",")}]`,
  );

  const ref = gateJson(REF_ONLY, gitRepo);
  const viaRef = ref.parsed ? ref.parsed.facts.evidence.filter((e) => e.via_ref).map((e) => e.value) : [];
  check(
    "operative evidence on another ref is accepted (A4, no R5)",
    ref.code === 0 && advisoryRules(ref).includes("A4_EVIDENCE_OFF_TREE") && viaRef.length === 1,
    `exit=${ref.code} adv=[${advisoryRules(ref).join(",")}] via_ref=[${viaRef.join(",")}] out=${ref.out.slice(0, 160).replace(/\n/g, " ")}`,
  );

  const def = gateJson(DEFER_SUPPRESSED);
  check(
    "explicit verdict + linked qa child is NOT a deferral (no A2)",
    def.code === 0 && def.parsed !== null && def.parsed.facts.deferral === null && !advisoryRules(def).includes("A2_DEFERRAL_OPEN"),
    `exit=${def.code} deferral=${JSON.stringify(def.parsed && def.parsed.facts.deferral)} adv=[${advisoryRules(def).join(",")}]`,
  );

  const legacy = gateJson(DEFERRED_OPEN);
  check(
    "linked qa child with NO verdict still counts as a deferral (A2 fires — heuristic intact)",
    legacy.code === 0 && legacy.parsed !== null && legacy.parsed.facts.deferral !== null && advisoryRules(legacy).includes("A2_DEFERRAL_OPEN"),
    `exit=${legacy.code} deferral=${JSON.stringify(legacy.parsed && legacy.parsed.facts.deferral)} adv=[${advisoryRules(legacy).join(",")}]`,
  );

  const stale = gateJson(STALE_DEFERRAL);
  check(
    "stale deferral marker is superseded by the newer verdict — no R8, no deferral (t_58280940)",
    stale.code === 0 && stale.parsed !== null && stale.parsed.facts.deferral === null && violationRules(stale).length === 0,
    `exit=${stale.code} deferral=${JSON.stringify(stale.parsed && stale.parsed.facts.deferral)} rules=[${violationRules(stale).join(",")}]`,
  );

  const staleChild = gateJson(STALE_DEFERRAL_OPEN_CHILD);
  check(
    "stale deferral marker to an open QA child is superseded too — no A2 (t_58280940)",
    staleChild.code === 0 &&
      staleChild.parsed !== null &&
      staleChild.parsed.facts.deferral === null &&
      !advisoryRules(staleChild).includes("A2_DEFERRAL_OPEN"),
    `exit=${staleChild.code} deferral=${JSON.stringify(staleChild.parsed && staleChild.parsed.facts.deferral)} adv=[${advisoryRules(staleChild).join(",")}]`,
  );

  const quoted = gateJson(QUOTED_DEFERRAL);
  check(
    "a marker that only appears in a code span is not a deferral (no phantom R8)",
    quoted.code === 1 &&
      quoted.parsed !== null &&
      quoted.parsed.facts.deferral === null &&
      violationRules(quoted).includes("R1_QA_VERDICT_MISSING") &&
      !violationRules(quoted).includes("R8_DEFERRAL_TARGET_INVALID"),
    `exit=${quoted.code} deferral=${JSON.stringify(quoted.parsed && quoted.parsed.facts.deferral)} rules=[${violationRules(quoted).join(",")}]`,
  );

  const staleQuoted = gateJson(STALE_DEFERRAL_QUOTED);
  check(
    "a quoted marker must not hijack the newest-marker ordering over a real one (t_58280940)",
    staleQuoted.code === 0 &&
      staleQuoted.parsed !== null &&
      staleQuoted.parsed.facts.deferral === null &&
      violationRules(staleQuoted).length === 0,
    `exit=${staleQuoted.code} deferral=${JSON.stringify(staleQuoted.parsed && staleQuoted.parsed.facts.deferral)} rules=[${violationRules(staleQuoted).join(",")}]`,
  );
}

console.log("\n2. Rule coverage (every rule must fire on its own non-compliant card):");
expectRule("no verdict, no evidence", NO_VERDICT, "R1_QA_VERDICT_MISSING");
expectRule("no verdict, no evidence", NO_VERDICT, "R4_EVIDENCE_MISSING");
// Split across lines on purpose: gitleaks' generic-api-key rule flags the
// `SOMETHING_TOKEN, "…"` shape as a keyword+value assignment (CI secret-scan).
expectRule(
  "verdict token outside vocabulary",
  BAD_VERDICT_FIXTURE,
  "R2_QA_VERDICT_INVALID",
);
expectRule("fail verdict on a done card", FAIL_ON_DONE, "R3_VERDICT_NOT_TERMINAL");
expectRule("blocked verdict on a done card", BLOCKED_ON_DONE, "R3_VERDICT_NOT_TERMINAL");
expectRule("verdict without evidence", NO_EVIDENCE, "R4_EVIDENCE_MISSING", { forbid: ["R1_QA_VERDICT_MISSING"] });
expectRule("named evidence file missing", MISSING_FILE, "R5_EVIDENCE_FILE_MISSING");
expectRule("operative verdict names a missing artifact (scoping is not vacuous)", OPERATIVE_MISSING, "R5_EVIDENCE_FILE_MISSING", {
  forbid: ["R1_QA_VERDICT_MISSING", "R4_EVIDENCE_MISSING"],
});
expectRule("pass-with-conditions without follow-up", UNTRACKED_CONDITIONS, "R6_CONDITIONS_UNTRACKED");
expectRule("crypto card without architect sign-off", SEC_NO_ARCH, "R7_SECURITY_TRACK_SIGNOFF_MISSING");
expectRule("deferral to a non-QA card", DEFER_NON_QA, "R8_DEFERRAL_TARGET_INVALID", { forbid: ["R2_QA_VERDICT_INVALID"] });
expectRule("deferral to a phantom card", DEFER_PHANTOM, "R8_DEFERRAL_TARGET_INVALID", { forbid: ["R2_QA_VERDICT_INVALID"] });
expectRule("newest record is a deferral to a non-QA card (superseding is ordered, not amnesty)", FRESH_DEFERRAL_NON_QA, "R8_DEFERRAL_TARGET_INVALID", {
  forbid: ["R2_QA_VERDICT_INVALID", "R1_QA_VERDICT_MISSING", "R4_EVIDENCE_MISSING"],
});
expectRule("quoted marker is documentation, not a deferral (R8 must not fire)", QUOTED_DEFERRAL, "R1_QA_VERDICT_MISSING", {
  forbid: ["R8_DEFERRAL_TARGET_INVALID", "R2_QA_VERDICT_INVALID"],
});

console.log("\n3. --strict-history turns grandfathered gaps into failures:");
{
  const r = runGate(["audit", "--db", db, "--repo", repo, "--strict-history", "--json", "--epoch-iso", "2026-09-17T00:00:00Z"]);
  const parsed = JSON.parse(r.out);
  const preEpochFail = parsed.results.find((x) => x.facts.task_id === PRE_EPOCH);
  check(
    "pre-epoch card fails under --strict-history",
    r.code === 1 && preEpochFail && preEpochFail.violations.some((v) => v.rule === "A1_HISTORY_UNGATED"),
    `exit=${r.code}`,
  );
  const r2 = runGate(["audit", "--db", db, "--repo", repo, "--json", "--epoch-iso", "2026-09-17T00:00:00Z"]);
  const parsed2 = JSON.parse(r2.out);
  const preEpochWarn = parsed2.results.find((x) => x.facts.task_id === PRE_EPOCH);
  check(
    "same card is advisory-only without --strict-history",
    preEpochWarn && preEpochWarn.violations.length === 0 && preEpochWarn.advisories.some((a) => a.rule === "A1_HISTORY_UNGATED"),
    `violations=${preEpochWarn ? preEpochWarn.violations.length : "n/a"} advisories=${preEpochWarn ? preEpochWarn.advisories.map((a) => a.rule).join(",") : "n/a"}`,
  );
}

console.log("\n4. Audit on the fixture board reports the enforced failures and exits 1:");
{
  const r = runGate(["audit", "--db", db, "--repo", repo, "--json"]);
  const parsed = JSON.parse(r.out);
  const ids = parsed.results.filter((x) => x.facts.post_epoch && x.violations.length).map((x) => x.facts.task_id);
  check("audit exits 1 with enforced failures", r.code === 1 && ids.length >= 10, `exit=${r.code} failures=${ids.length}`);
  const hist = parsed.counts.grandfathered;
  check("audit counts the grandfathered card separately", hist === 1, `grandfathered=${hist}`);
}

console.log("\n5. Hook mode (pre_tool_call: kanban_complete):");
{
  const payload = (taskId, where = "input") => {
    const base = {
      hook_event_name: "pre_tool_call",
      tool_name: "kanban_complete",
      tool_input: { task_id: taskId, summary: "done" },
      session_id: "sess_fixture",
      cwd: repo,
      profile: "backend",
      extra: { task_id: taskId, tool_call_id: "tc_1" },
    };
    if (where === "extra") delete base.tool_input.task_id;
    if (where === "env") {
      delete base.tool_input.task_id;
      delete base.extra.task_id;
    }
    return JSON.stringify(base);
  };

  const blocked = runGate(["hook", "--db", db], payload(NO_VERDICT), { HERMES_KANBAN_DB: db });
  let directive = null;
  try {
    directive = JSON.parse(blocked.out.split("\n")[0]);
  } catch {
    directive = null;
  }
  check(
    "non-compliant card → block directive + exit 2",
    blocked.code === 2 && directive && directive.decision === "block" && /R1_QA_VERDICT_MISSING/.test(directive.reason) && /R4_EVIDENCE_MISSING/.test(directive.reason),
    `exit=${blocked.code} out=${blocked.out.slice(0, 240).replace(/\n/g, " ")}`,
  );

  const allowed = runGate(["hook", "--db", db], payload(OK), { HERMES_KANBAN_DB: db });
  check("compliant card → {} + exit 0", allowed.code === 0 && allowed.out.trim() === "{}", `exit=${allowed.code} out=${allowed.out.trim().slice(0, 120)}`);

  const viaExtra = runGate(["hook", "--db", db], payload(OK, "extra"), { HERMES_KANBAN_DB: db });
  check("task id resolved from extra.task_id", viaExtra.code === 0, `exit=${viaExtra.code} out=${viaExtra.out.trim().slice(0, 120)}`);

  const viaEnv = runGate(["hook", "--db", db], payload(OK, "env"), { HERMES_KANBAN_DB: db, HERMES_KANBAN_TASK: OK });
  check("task id resolved from HERMES_KANBAN_TASK", viaEnv.code === 0, `exit=${viaEnv.code} out=${viaEnv.out.trim().slice(0, 120)}`);

  const otherTool = runGate(["hook", "--db", db], JSON.stringify({ tool_name: "terminal", tool_input: { command: "ls" } }), { HERMES_KANBAN_DB: db });
  check("other tool names pass through", otherTool.code === 0, `exit=${otherTool.code}`);

  const broken = runGate(["hook", "--db", db], "{not json", { HERMES_KANBAN_DB: db });
  check("unparseable payload → fail closed (block)", broken.code === 2 && /fail/i.test(broken.out), `exit=${broken.code} out=${broken.out.slice(0, 160)}`);

  const noBoard = runGate(["hook", "--db", join(root, "nope.db")], payload(OK), { HERMES_KANBAN_DB: join(root, "nope.db") });
  check("unreadable board → fail closed (block)", noBoard.code === 2 && /Failing closed/.test(noBoard.out), `exit=${noBoard.code} out=${noBoard.out.slice(0, 160)}`);

  const noTask = runGate(["hook", "--db", db], JSON.stringify({ tool_name: "kanban_complete", tool_input: {} }), { HERMES_KANBAN_DB: db, HERMES_KANBAN_TASK: "" });
  check("no resolvable task id → fail closed (block)", noTask.code === 2, `exit=${noTask.code}`);

  // ── t_5455942d: resolving the session id instead of the task id ───────────
  const sessionShape = "20260917_201256_021f5e";
  const sessionPayload = JSON.stringify({
    hook_event_name: "pre_tool_call",
    tool_name: "kanban_complete",
    tool_input: { summary: "no explicit task_id (tool default)" },
    session_id: sessionShape,
    cwd: repo,
    profile: "qa",
    extra: { task_id: sessionShape, tool_call_id: "tc_1" },
  });

  const sessionEnv = runGate(["hook", "--db", db], sessionPayload, { HERMES_KANBAN_DB: db, HERMES_KANBAN_TASK: OK });
  check(
    "(a) session id in extra.task_id + HERMES_KANBAN_TASK set → allow ({} + exit 0)",
    sessionEnv.code === 0 && sessionEnv.out.trim() === "{}",
    `exit=${sessionEnv.code} out=${sessionEnv.out.trim().slice(0, 220)}`,
  );

  const sessionOnly = runGate(["hook", "--db", db], sessionPayload, { HERMES_KANBAN_DB: db, HERMES_KANBAN_TASK: "" });
  let sessionDirective = null;
  try {
    sessionDirective = JSON.parse(sessionOnly.out.split("\n")[0]);
  } catch {
    sessionDirective = null;
  }
  check(
    "(b) session id only → block, reason names the source and the id shape",
    sessionOnly.code === 2 &&
      sessionDirective &&
      /extra\.task_id/.test(sessionDirective.reason) &&
      /not a task id/.test(sessionDirective.reason) &&
      /Hermes session id/.test(sessionDirective.reason),
    `exit=${sessionOnly.code} out=${sessionOnly.out.slice(0, 260).replace(/\n/g, " ")}`,
  );

  const explicitId = runGate(["hook", "--db", db], payload(OK), { HERMES_KANBAN_DB: db, HERMES_KANBAN_TASK: "" });
  check("(c) explicit tool_input.task_id → allow", explicitId.code === 0 && explicitId.out.trim() === "{}", `exit=${explicitId.code}`);

  const unknownId = runGate(["hook", "--db", db], payload("t_deadbeef"), { HERMES_KANBAN_DB: db, HERMES_KANBAN_TASK: OK });
  let unknownDirective = null;
  try {
    unknownDirective = JSON.parse(unknownId.out.split("\n")[0]);
  } catch {
    unknownDirective = null;
  }
  check(
    "(d) unknown task id → block, reason names the source of the id",
    unknownId.code === 2 &&
      unknownDirective &&
      /t_deadbeef/.test(unknownDirective.reason) &&
      /tool_input\.task_id/.test(unknownDirective.reason),
    `exit=${unknownId.code} out=${unknownId.out.slice(0, 260).replace(/\n/g, " ")}`,
  );

  // A run id (numeric) is resolved through the board, never treated as a card id.
  const runRow = execFileSync("sqlite3", ["-json", "--", db, `SELECT id FROM task_runs WHERE task_id='${QA_OWN}' LIMIT 1`], {
    encoding: "utf8",
  }).trim();
  const runId = runRow ? JSON.parse(runRow)[0].id : null;
  const runPayload = JSON.stringify({
    hook_event_name: "pre_tool_call",
    tool_name: "kanban_complete",
    tool_input: { task_id: runId, summary: "dispatcher passed a run id" },
    session_id: sessionShape,
    cwd: repo,
    profile: "qa",
    extra: { tool_call_id: "tc_2" },
  });
  const viaRunId = runGate(["hook", "--db", db], runPayload, { HERMES_KANBAN_DB: db, HERMES_KANBAN_TASK: "" });
  check(
    "(e) numeric run id in tool_input.task_id → resolved to its card via the board → allow",
    runId !== null && viaRunId.code === 0 && viaRunId.out.trim() === "{}",
    `run=${runId} exit=${viaRunId.code} out=${viaRunId.out.trim().slice(0, 220)}`,
  );

  // The real dispatcher-worker shape: Hermes scrubs the kanban identity variables
  // out of the hook's env (agent/delegation_context.py::scrub_kanban_env), so the
  // hook must fall back to the worker's location. Evidence: hook-env-probe.py.
  // The worker's cwd holds its own evidence, exactly like a real workspace.
  const workerCwd = join(root, "workspaces", OK);
  mkdirSync(dirname(join(workerCwd, "tests/evidence", OK, "README.md")), { recursive: true });
  writeFileSync(join(workerCwd, "tests/evidence", OK, "README.md"), "synthetic evidence fixture (worker workspace)\n");
  const workerPayload = JSON.stringify({
    hook_event_name: "pre_tool_call",
    tool_name: "kanban_complete",
    tool_input: { summary: "natural call — task_id defaulted by the tool" },
    session_id: sessionShape,
    cwd: workerCwd,
    profile: "backend",
    extra: { task_id: sessionShape, tool_call_id: "tc_3" },
  });

  const viaWorkspace = runGate(["hook", "--db", db], workerPayload, {
    HERMES_KANBAN_DB: db,
    HERMES_KANBAN_TASK: "",
    HERMES_KANBAN_WORKSPACE: workerCwd,
  });
  check(
    "(f) identity vars scrubbed (no HERMES_KANBAN_TASK) + session id in extra → resolved from HERMES_KANBAN_WORKSPACE → allow",
    viaWorkspace.code === 0 && viaWorkspace.out.trim() === "{}",
    `exit=${viaWorkspace.code} out=${viaWorkspace.out.trim().slice(0, 260)}`,
  );

  const viaCwd = runGate(["hook", "--db", db], workerPayload, {
    HERMES_KANBAN_DB: db,
    HERMES_KANBAN_TASK: "",
    HERMES_KANBAN_WORKSPACE: "",
    HERMES_KANBAN_BRANCH: "",
  });
  check(
    "(g) same payload, workspace var empty → resolved from the worker's cwd basename → allow",
    viaCwd.code === 0 && viaCwd.out.trim() === "{}",
    `exit=${viaCwd.code} out=${viaCwd.out.trim().slice(0, 260)}`,
  );

  const noLocation = JSON.stringify({
    hook_event_name: "pre_tool_call",
    tool_name: "kanban_complete",
    tool_input: { summary: "no id, no location" },
    session_id: sessionShape,
    cwd: repo,
    profile: "backend",
    extra: { task_id: sessionShape },
  });
  const unresolvable = runGate(["hook", "--db", db], noLocation, {
    HERMES_KANBAN_DB: db,
    HERMES_KANBAN_TASK: "",
    HERMES_KANBAN_WORKSPACE: "",
    HERMES_KANBAN_BRANCH: "",
  });
  let unresolvableDirective = null;
  try {
    unresolvableDirective = JSON.parse(unresolvable.out.split("\n")[0]);
  } catch {
    unresolvableDirective = null;
  }
  check(
    "(h) no id and no task-shaped location → still fails closed, listing every source tried",
    unresolvable.code === 2 &&
      unresolvableDirective &&
      /tool_input\.task_id=<empty>/.test(unresolvableDirective.reason) &&
      /extra\.task_id/.test(unresolvableDirective.reason) &&
      /cwd=/.test(unresolvableDirective.reason),
    `exit=${unresolvable.code} out=${unresolvable.out.slice(0, 300).replace(/\n/g, " ")}`,
  );

  // kill switch
  const kill = join(root, "signoff-gate.disabled");
  writeFileSync(kill, "temporarily disabled by operator\n");
  const killed = runGate(["hook", "--db", db], payload(NO_VERDICT), { HERMES_KANBAN_DB: db, HERMES_HOME: root });
  check("kill switch allows completion", killed.code === 0 && killed.out.trim() === "{}", `exit=${killed.code}`);
  rmSync(kill, { force: true });
}

console.log(`\n${cases - failures.length}/${cases} cases passed`);
if (failures.length) {
  console.log("\nFAILED CASES:");
  for (const f of failures) console.log(`  - ${f}`);
  if (!KEEP) rmSync(root, { recursive: true, force: true });
  process.exit(1);
}
if (!KEEP) rmSync(root, { recursive: true, force: true });
process.exit(0);
