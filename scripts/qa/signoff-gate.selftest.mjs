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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// `task_events` mirrors the Hermes schema (t_5b5b61e2: the audit reads the
// `completed` / `manual_complete` events to list completions made outside the
// hook). Kept separate so a legacy board WITHOUT it can be built (section 10).
const EVENTS_SQL = `CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL,
  payload TEXT, created_at INTEGER NOT NULL
);
`;
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
${EVENTS_SQL}`;

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

// ── t_b8001b55: who may record an exception, and where it never applies ─────
// Before the fix, findException displayed the author but never checked it, took
// a key quoted in a code span for a real exception, and let any exception waive
// R7 on a crypto/bridge/auth card.
const EXC_REASON = "qa-signoff-exception: hotfix under incident INC-002, QA verdict waived for 24h";

// (1) a non-allowed author — a named executing profile, and the anonymous
// `worker`, which names no profile at all — is ignored: R1 and R4 still fire.
const EXC_BY_BACKEND = card({
  title: "BE-910a exception recorded by an executing profile",
  body: "**Test Types:** unit",
  comments: [{ author: "backend", body: EXC_REASON }],
});
const EXC_BY_WORKER = card({
  title: "BE-910b exception recorded by the anonymous worker author",
  body: "**Test Types:** unit",
  comments: [{ author: "worker", body: EXC_REASON }],
});

// (2) a key inside a code span / fence is a quotation. The first fixture is the
// live record that exposed the defect: comment 551 on t_75180b28, verbatim
// (architect, reporting this bug) — the gate turned its backtick quote into that
// card's operative X1_EXCEPTION.
const LIVE_551 = readFileSync(join(HERE, "fixtures", "t_75180b28-comment-551.md"), "utf8");
const EXC_QUOTED_LIVE = card({
  title: "BE-911a defect report that quotes the exception key (live t_75180b28 #551)",
  body: "**Test Types:** unit",
  status: "triage",
  completed: null,
  comments: [{ author: "architect", body: LIVE_551 }],
});
const EXC_QUOTED_FENCE = card({
  title: "BE-911b exception key quoted in a fenced block",
  body: "**Test Types:** unit",
  comments: [{ author: "architect", body: "The recording command is:\n\n```\nhermes kanban comment t_x --body \"qa-signoff-exception: <reason>\"\n```\n\nnot used here." }],
});
// Non-vacuity of the quote rule: the same comment quotes the key AND records a
// real one below — the real one is operative (the scan is per occurrence).
const EXC_QUOTED_THEN_REAL = card({
  title: "BE-911c comment quotes the key, then records a real exception",
  body: "**Test Types:** unit",
  comments: [{ author: "architect", body: `The marker is \`qa-signoff-exception: <reason>\`.\n\n${EXC_REASON}` }],
});
// Ordering: a refused record first must not shadow an allowed one after it
// (the old `.find()` kept the first match, irrevocably).
const EXC_REFUSED_THEN_ALLOWED = card({
  title: "BE-911d refused exception, then an allowed one",
  body: "**Test Types:** unit",
  comments: [
    { author: "frontend", body: EXC_REASON },
    { author: "architect", body: EXC_REASON },
  ],
});

// (3) security-track card: even the most privileged authors cannot waive AR-6 —
// R7 AND R1 must still fire (and R4: an exception that waives nothing leaves
// the evidence requirement standing).
const EXC_SECURITY = card({
  title: "BE-912 crypto card closed by exception",
  body: "**Test Types:** unit, security\nImplements the packages/crypto AEAD wrapper and vault key loading.",
  comments: [
    { author: "dashboard", body: EXC_REASON },
    { author: "architect", body: EXC_REASON },
    { author: "qa", body: EXC_REASON },
  ],
});

// (4) non-vacuity: every allowed author still records a valid exception on a
// non-security card (architect is the case named in the card).
const EXC_ALLOWED = Object.fromEntries(
  ["architect", "qa", "human", "dashboard", "user"].map((author) => [
    author,
    card({ title: `BE-913 exception recorded by ${author}`, body: "**Test Types:** unit", comments: [{ author, body: EXC_REASON }] }),
  ]),
);

// ── t_b2588ee7: an exception can be withdrawn by a later record ─────────────
// Before the fix the first applied exception was irrevocable (`.find()`), and a
// withdrawal-shaped record could even be read AS an exception.
const WDR_REASON = "qa-signoff-exception withdrawn: the incident is closed, the card needs a real QA verdict";
const EXC_THEN_WDR = card({
  title: "BE-920a exception, then withdrawn by the same author",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: EXC_REASON },
    { author: "architect", body: WDR_REASON },
  ],
});
const EXC_THEN_WDR_OTHER = card({
  title: "BE-920b exception by the dashboard, withdrawn by qa",
  body: "**Test Types:** unit",
  comments: [
    { author: "dashboard", body: EXC_REASON },
    { author: "qa", body: WDR_REASON },
  ],
});
const EXC_THEN_WDR_BACKEND = card({
  title: "BE-921a withdrawal by an executing profile",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: EXC_REASON },
    { author: "backend", body: WDR_REASON },
  ],
});
const EXC_THEN_WDR_WORKER = card({
  title: "BE-921b withdrawal by the anonymous worker author",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: EXC_REASON },
    { author: "worker", body: WDR_REASON },
  ],
});
const EXC_THEN_WDR_QUOTED = card({
  title: "BE-921c withdrawal key only quoted in a code span",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: EXC_REASON },
    { author: "architect", body: "To end it, post `qa-signoff-exception withdrawn: <reason>` — not done yet." },
  ],
});
// (3) a withdrawal with nothing to withdraw: no effect, no crash.
const WDR_ONLY = card({
  title: "BE-922a withdrawal on a card that never had an exception",
  body: "**Test Types:** unit",
  comments: [{ author: "architect", body: WDR_REASON }],
});
const WDR_ONLY_COMPLIANT = card({
  title: "BE-922b compliant card with a stray withdrawal",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: "qa-signoff-exception withdrawn" },
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md"),
  ],
});
fixtureFile(`tests/evidence/${WDR_ONLY_COMPLIANT}/README.md`);
// Order matters: a withdrawal only ends an exception recorded BEFORE it.
const WDR_BEFORE_EXC = card({
  title: "BE-922c withdrawal posted before the exception",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: WDR_REASON },
    { author: "architect", body: EXC_REASON },
  ],
});
const EXC_WDR_EXC = card({
  title: "BE-923a exception, withdrawal, exception again (re-armed)",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: EXC_REASON },
    { author: "qa", body: WDR_REASON },
    { author: "human", body: "qa-signoff-exception: re-approved for INC-003 after review" },
  ],
});
const EXC_WDR_SAME_COMMENT = card({
  title: "BE-923b exception and withdrawal in one comment, in that order",
  body: "**Test Types:** unit",
  comments: [{ author: "architect", body: `${EXC_REASON}\n\n${WDR_REASON}` }],
});
// Same-second tie: the board's created_at has second resolution; the id
// (posting order) must break the tie.
const EXC_WDR_SAME_SECOND = card({
  title: "BE-923c exception and withdrawal posted in the same second",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: EXC_REASON, at: 0 },
    { author: "architect", body: WDR_REASON, at: 0 },
  ],
});
// A withdrawal-shaped record must never be read as an exception (the old
// EXCEPTION_RE matched both spellings below and turned them into waivers).
const WDR_SHAPES_ALONE = ["qa-signoff-exception-withdrawn: no longer needed", "qa-signoff-exception: withdrawn — no longer needed"].map((body, i) =>
  card({ title: `BE-924${"ab"[i]} withdrawal spelling alone is not an exception`, body: "**Test Types:** unit", comments: [{ author: "architect", body }] }),
);
const EXC_SECURITY_WDR = card({
  title: "BE-925 crypto card: exception refused, withdrawal is a no-op",
  body: "**Test Types:** unit, security\nImplements the packages/crypto AEAD wrapper and vault key loading.",
  comments: [
    { author: "architect", body: EXC_REASON },
    { author: "architect", body: WDR_REASON },
  ],
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
//
// Both records are `qa`-authored: per the §3 author rule (t_338f47fd) only a QA
// profile records a verdict, so a marker from another author is not a live
// deferral at all and this case would otherwise be vacuous. The marker names
// OK (a *done non-QA* card), so it is an R8 violation the moment it is
// operative — which is what proves the ordering, not the authorship.
const STALE_DEFERRAL = card({
  title: "BE-915 stale deferral marker, QA verdict recorded afterwards",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict(`QA-VERDICT: deferred — ${OK} (waiting on the gate)`),
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md"),
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

// ── t_99e408c5 regression fixtures ──────────────────────────────────────────
// A verdict that *reports* a broken evidence pointer on another card names that
// card's path while recording its own. Naming is not claiming: R5 may resolve
// only the paths the verdict presents as its own evidence (QA_SIGN_OFF_GATE.md
// §5.7 — `Evidence:` label, outside code spans/fences); every other path in the
// operative verdict is a *citation* and is reported as `A6_EVIDENCE_CITED`.
const CITED_ABSENT = "t_fffffff1"; // never committed on any ref
const CITED_PRESENT = "t_fffffff2"; // artifact exists in the fixture checkout
fixtureFile(`tests/evidence/${CITED_PRESENT}/README.md`);

const QUOTED_PATH_REPORT = card({
  title: "QA-920 operative verdict reports another card's missing evidence (the reported instance)",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [
    qaVerdict(
      [
        "## QA-VERDICT: pass — delivered, owners named for what remains",
        "",
        "**Evidence:** tests/evidence/__ID__/README.md and the transcripts in that directory.",
        "",
        `**Also reported:** R5 finding on \`${CITED_ABSENT}\` (its verdict names \`tests/evidence/${CITED_ABSENT}/README.md\`, absent from every ref) — commented on that card for its owner.`,
        "",
        "```",
        `FAIL ${CITED_ABSENT} architect :: R5_EVIDENCE_FILE_MISSING`,
        `  evidence file named in the operative verdict does not exist: tests/evidence/${CITED_ABSENT}/README.md`,
        "```",
      ].join("\n"),
    ),
  ],
});
fixtureFile(`tests/evidence/${QUOTED_PATH_REPORT}/README.md`);

const QUOTED_PATH_PRESENT = card({
  title: "QA-921 operative verdict cites another card's artifact that does exist",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [
    qaVerdict(
      [
        "QA-VERDICT: pass — cross-checked against the neighbouring card's record.",
        "",
        "**Evidence:** tests/evidence/__ID__/README.md",
        "",
        `Cross-checked with \`tests/evidence/${CITED_PRESENT}/README.md\` (that card's artifact).`,
      ].join("\n"),
    ),
  ],
});
fixtureFile(`tests/evidence/${QUOTED_PATH_PRESENT}/README.md`);

// Controls: a *claimed* artifact that does not exist still fails R5 — the fix
// must not degenerate into "ignore missing evidence".
const LABELLED_MISSING = card({
  title: "QA-922 labelled evidence file is missing (R5 control)",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/claimed-missing.md")],
});

const LABELLED_MISSING_CODESPAN = card({
  title: "QA-923 labelled evidence file is missing, written in a code span (R5 control)",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [qaVerdict("QA-VERDICT: pass — **Evidence:** `tests/evidence/__ID__/claimed-missing-codespan.md`")],
});

// No evidence label at all: a path inside a code span is documentation (A6),
// while a path in plain prose is still a claim (R5).
const NOLABEL_CODESPAN_MISSING = card({
  title: "QA-924 no label: a quoted path in a code span is a citation, not a claim",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [
    qaVerdict(
      [
        "QA-VERDICT: pass — 12/12 green, transcript at tests/evidence/__ID__/README.md",
        "",
        `Reported on \`${CITED_ABSENT}\`: \`tests/evidence/${CITED_ABSENT}/README.md\` is absent from every ref.`,
      ].join("\n"),
    ),
  ],
});
fixtureFile(`tests/evidence/${NOLABEL_CODESPAN_MISSING}/README.md`);

const NOLABEL_PROSE_MISSING = card({
  title: "QA-925 no label: a path in plain prose is still the card's claim (R5 control)",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [qaVerdict("QA-VERDICT: pass — see tests/evidence/__ID__/prose-missing.md for the transcript.")],
});

// ── t_338f47fd regression fixtures ──────────────────────────────────────────
// `VERDICT_MARKER_RE` was matched **without an author check**, so one
// `QA-VERDICT: <token>` comment written by `architect`, `frontend`, `dashboard`
// or any other profile cleared R1/R2/R3 on that card — and the fail-closed
// completion hook with it. Not theoretical: the live board carries 16 such
// comments, and on t_e348e0b7 / t_28951254 / t_28f60dc1 / t_2162d273 the
// architect-authored marker *is* the operative verdict.
//
// The two cards below carry the **same comment text** and differ only in its
// author — authorship is the whole variable, so the pair isolates it.
const SAME_MARKER_TEXT = "QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md";

const QA_MARKER_AUTHOR = card({
  title: "QA-930 the marker comment authored by qa (non-vacuity control)",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [qaVerdict(SAME_MARKER_TEXT)],
});
fixtureFile(`tests/evidence/${QA_MARKER_AUTHOR}/README.md`);

const NONQA_MARKER_AUTHOR = card({
  title: "BE-930 the same marker comment authored by architect (must NOT satisfy R1)",
  body: "**Test Types:** unit",
  comments: [{ author: "architect", body: SAME_MARKER_TEXT }],
});
fixtureFile(`tests/evidence/${NONQA_MARKER_AUTHOR}/README.md`);

// R3 half of the impact: a non-QA `blocked` marker must not make a done card
// fail R3 either — the verdict is author-scoped as a whole, not only for R1.
const NONQA_BLOCKED_MARKER = card({
  title: "BE-931 non-QA 'blocked' marker must not create R3 on a done card",
  body: "**Test Types:** unit",
  comments: [
    {
      author: "architect",
      body: "QA-VERDICT: blocked — waiting on the vault KDF — evidence: https://github.com/zeldadil/password-manager/actions/runs/1",
    },
  ],
});

// A deferral marker is a QA verdict record too (§3 row 4): a non-QA `deferred`
// marker may neither satisfy R1 nor be judged by R8.
const NONQA_DEFERRAL = card({
  title: "BE-932 deferral marker from a non-QA author is not a deferral",
  body: "**Test Types:** unit",
  comments: [{ author: "architect", body: `QA-VERDICT: deferred — ${DEFERRED_CHILD_DONE}` }],
});

// The live thread shape (t_f49d448c / t_58280940, reported defect transcript):
// an architect deferral marker plus a dashboard verdict marker. Under the old
// gate this card passed R1; under the author rule neither record is a verdict.
const NONQA_MARKERS_LIVE_SHAPE = card({
  title: "BE-933 architect deferral marker + dashboard verdict marker (live shape)",
  body: "**Test Types:** unit",
  comments: [
    { author: "architect", body: `QA-VERDICT: deferred — ${OK} (waiting on the gate)` },
    {
      author: "dashboard",
      body: "@qa check this ticket please : QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md",
    },
  ],
});
fixtureFile(`tests/evidence/${NONQA_MARKERS_LIVE_SHAPE}/README.md`);

// Anti-degradation controls for the two sources the author rule must NOT touch
// (§3 AC 1c): a qa-authored loose verdict is still a verdict, and a non-QA loose
// verdict is still ignored exactly as before (it never was a marker).
const LOOSE_QA = card({
  title: "QA-934 qa-authored loose verdict (path unchanged)",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [
    qaVerdict("Round-2 review of the envelope tests — verdict: pass.\nEvidence: tests/evidence/__ID__/README.md"),
  ],
});
fixtureFile(`tests/evidence/${LOOSE_QA}/README.md`);

const LOOSE_NONQA = card({
  title: "BE-934 loose verdict from a non-QA author (author rule already applied here)",
  body: "**Test Types:** unit",
  comments: [{ author: "frontend", body: "verdict: pass — evidence: tests/evidence/__ID__/README.md" }],
});
fixtureFile(`tests/evidence/${LOOSE_NONQA}/README.md`);

// Run metadata remains the one author-independent source (§3 row 3, AC 1c):
// accepted — but a non-QA run self-declaring its verdict is reported as A8 so
// the residual, documented hole is never invisible.
const NONQA_RUN_METADATA = card({
  title: "BE-935 non-QA run-metadata verdict (accepted per §3, reported as A8)",
  body: "**Test Types:** unit",
  runs: [
    {
      profile: "architect",
      status: "done",
      outcome: "completed",
      metadata: JSON.stringify({
        verdict: "pass",
        artifacts: ["https://github.com/zeldadil/password-manager/actions/runs/333"],
      }),
    },
  ],
});

// ── t_df8e644a regression fixtures ─────────────────────────────────────────
// `VERDICT_LOOSE_RE` accepted `-` and `—` as separators (`/verdict\s*[:\-—]+\s*/`),
// while `VERDICT_MARKER_RE` has been colon-only since `t_c3cb6842`. So a `qa`
// comment that merely **cites** an evidence file name it does not record —
// `tests/evidence/t_0af5aa3e/QA-VERDICT-ROTATION.md` — produced the token
// "rotation" and failed the card with `R2_QA_VERDICT_INVALID`. Reproduced on the
// live board: `qa` comment 49 on `t_80fc0326` (the residual half of `t_c3cb6842`;
// the gate must never read *a path it is shown* as a verdict token).
//
// The three cards below differ only in where the same file name is cited, so the
// pair isolates the shape (plain prose / code span / fenced block) from the fact.
const CITED_EVIDENCE_FILE = "tests/evidence/t_0af5aa3e/QA-VERDICT-ROTATION.md";

const CITED_PATH_PLAIN = card({
  title: "BE-940 a qa comment citing an evidence file name in plain prose",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict(
      `Reported on t_80fc0326: the reproduction lives in ${CITED_EVIDENCE_FILE} on the review branch.`,
    ),
  ],
});

const CITED_PATH_CODESPAN = card({
  title: "BE-941 a qa comment citing an evidence file name inside a code span",
  body: "**Test Types:** unit",
  comments: [qaVerdict(`Reported on t_80fc0326 — full context + reproduction: \`${CITED_EVIDENCE_FILE}\` on branch \`qa/t_0af5aa3e-rotation-verdict\`.`)],
});

const CITED_PATH_FENCE = card({
  title: "BE-942 a qa comment citing an evidence file name inside a fenced block",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict(
      `Reported on t_80fc0326 — the paths involved:\n\n\`\`\`\n${CITED_EVIDENCE_FILE}\ntests/evidence/t_d20787de/loose-path-repro.txt\n\`\`\`\n\nSee the branch for the transcript.`,
    ),
  ],
});

// The live shape: a compliant card whose verdict *cites* another card's artifact
// while its own verdict stays clean. Before the fix this produced a phantom R2.
const CITED_PATH_WITH_VERDICT = card({
  title: "QA-943 compliant verdict comment citing the same file name (no phantom R2)",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [
    qaVerdict(
      `QA-VERDICT: pass — the gate defect is reproduced in \`${CITED_EVIDENCE_FILE}\`.\nEvidence: tests/evidence/__ID__/README.md`,
    ),
  ],
});
fixtureFile(`tests/evidence/${CITED_PATH_WITH_VERDICT}/README.md`);

// The masked-record shape: the cited file name comes *first* in the comment, and
// `VERDICT_LOOSE_RE` only ever reports the first match — so before the fix the
// cited path produced invalid "rotation" AND the comment's real loose verdict was
// never read at all (R2 + R1 on one comment). After the fix the path is not a
// match, so the first match is the verdict. Reported live shape: `t_80fc0326`
// comment 49 (path only) sits next to comments 62/63 (real off-vocabulary records).
const CITED_PATH_LOOSE_VERDICT = card({
  title: "QA-946 a cited file name placed BEFORE the comment's real loose verdict",
  body: "**Test Types:** meta",
  assignee: "qa",
  comments: [
    qaVerdict(
      `\`${CITED_EVIDENCE_FILE}\` holds the transcript.\nRound-2 review verdict: pass.\nEvidence: tests/evidence/__ID__/README.md`,
    ),
  ],
});
fixtureFile(`tests/evidence/${CITED_PATH_LOOSE_VERDICT}/README.md`);

// ── t_c015bda7 regression fixtures ─────────────────────────────────────────
// A verdict comment is immutable audit history, so a mistyped token can only be
// superseded, never retracted. R2 flagged **every** invalid token unconditionally,
// so one off-vocabulary verdict blocked the card permanently and the only way out
// was editing the audit trail. Live repro: `t_c7c986c7`, where `qa` wrote
// `QA-VERDICT: confirm supersession` (comment #403) and then the correctly
// formatted `QA-VERDICT: pass` 446s later (#406) — the card still failed.
//
// R5 already resolves the operative (newest) verdict only; R2 now does the same.
// The pair below pins the asymmetry: a later valid verdict heals an earlier bad
// token, but an earlier good verdict must NEVER mask a bad one that followed it.
// Comments are seeded at `EPOCH_AFTER + i`, so array order is timestamp order.
const INVALID_THEN_VALID = card({
  title: "BE-946 off-vocabulary verdict corrected by a later valid one (A5, no R2)",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict("QA-VERDICT: confirm supersession — all brief points covered by the replacement cards."),
    qaVerdict("QA-VERDICT: pass — Evidence: tests/evidence/__ID__/README.md"),
  ],
});
fixtureFile(`tests/evidence/${INVALID_THEN_VALID}/README.md`);

const VALID_THEN_INVALID = card({
  title: "BE-947 valid verdict followed by an off-vocabulary one still fires R2",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict("QA-VERDICT: pass — Evidence: tests/evidence/__ID__/README.md"),
    qaVerdict("QA-VERDICT: confirm supersession — on reflection this needs rework."),
  ],
});
fixtureFile(`tests/evidence/${VALID_THEN_INVALID}/README.md`);

// Anti-degradation controls for the same change: the loose path is a *fallback
// for a QA record written in prose*, not only a source of false positives.
const LOOSE_OFFVOCAB = card({
  title: "BE-944 qa comment whose off-vocabulary loose token IS the verdict (R2 control)",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict(
      "Round-1 review of the purge (t_80fc0326) — verdict: changes requested, rework required.\nEvidence: https://github.com/zeldadil/password-manager/actions/runs/35259047666",
    ),
  ],
});

const LOOSE_MISSING_EVIDENCE = card({
  title: "BE-945 qa loose verdict claiming an evidence file that does not exist (R5 control)",
  body: "**Test Types:** unit",
  comments: [
    qaVerdict(
      "Round-2 review — verdict: pass.\nEvidence: tests/evidence/t_fffffff3/does-not-exist.md",
    ),
  ],
});

// ── t_75180b28 fixtures: R9/R10, the PR-merged / merge-commit-CI rule ──────
// GitHub answers come from JSON fixtures (QA_GATE_GITHUB_FIXTURE), never from
// the network. Every card below carries a valid QA verdict + evidence, so R9 /
// R10 / A11 / A12 are the only rules that can change between them.
const PR_DONE_AT = Math.floor(Date.parse("2026-10-07T00:00:00Z") / 1000); // after PR_RULE_EPOCH_ISO
const PR_DONE_BEFORE_RULE = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000); // gate epoch < this < PR-rule epoch
function prCard(title, extra = {}) {
  const tid = card({
    title,
    body: "**Test Types:** unit",
    status: "review",
    completed: null,
    comments: [qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md")],
    ...extra,
  });
  fixtureFile(`tests/evidence/${tid}/README.md`);
  return tid;
}
const PR_OPEN = prCard("FE-950a code card whose PR is still open");
const PR_CLOSED = prCard("FE-950b code card whose PR was closed without being merged");
const PR_MERGED_RED = prCard("FE-950c merged PR, a required check red on the merge commit");
const PR_MERGED_GREEN = prCard("FE-950d merged PR, every required check green on the merge commit");
const PR_WRONG_BASE = prCard("FE-950e PR merged into a stacked feature branch, not master");
const PR_PENDING = prCard("FE-950f merged PR, required checks still running / missing on the merge commit");
const PR_GREEN_PLUS_OPEN = prCard("FE-950g merged green PR plus a second PR still open");
const PR_BRANCH_ONLY = prCard("FE-950h branch pushed, no PR ever opened");
const PR_DECLARED = prCard("FE-950i declares its deliverable as code, no PR", { body: "**Test Types:** unit\n**Deliverable:** code" });
const PR_NOT_CODE = prCard("DOC-950j no PR, no branch, no declaration");
const PR_EXCEPTION = prCard("FE-950k open PR plus a recorded sign-off exception", {
  comments: [
    qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md"),
    { author: "architect", body: "qa-signoff-exception: housekeeping waiver for the QA record only" },
  ],
});
const PR_DONE_OPEN = prCard("FE-950l completed through the CLI after the rule epoch, PR still open", { status: "done", completed: PR_DONE_AT });
const PR_DONE_OLD = prCard("FE-950m completed before the rule epoch, PR still open", { status: "done", completed: PR_DONE_BEFORE_RULE });

const sha = (c) => c.repeat(40);
const run = (name, conclusion, status = "completed") => ({ name, status, conclusion: status === "completed" ? conclusion : null, app_id: 15368 });
const merged = (number, task, oid, extra = {}) => ({
  number,
  title: `fixture PR ${number}`,
  // A declarative line (§5.9, t_7e8bf917): a prose mention no longer links.
  body: `Implements the card.\n\nCloses ${task}`,
  state: "MERGED",
  mergedAt: `2026-10-06T10:${String(number % 60).padStart(2, "0")}:00Z`,
  mergeCommit: { oid },
  baseRefName: "master",
  headRefName: `feature/pr-${number}`,
  url: `https://github.com/fixture-owner/fixture-repo/pull/${number}`,
  ...extra,
});
const open = (number, task, extra = {}) => ({ ...merged(number, task, null), state: "OPEN", mergedAt: null, mergeCommit: null, ...extra });
const GH_FIXTURE = {
  repo: "fixture-owner/fixture-repo",
  default_branch: "master",
  // Read from branch protection in real life — the gate never hard-codes it.
  required_checks: [
    { context: "lint-typecheck", app_id: 15368 },
    { context: "integration", app_id: null },
    { context: "build", app_id: 15368 },
  ],
  prs: [
    open(901, PR_OPEN),
    { ...open(902, PR_CLOSED), state: "CLOSED" },
    merged(903, PR_MERGED_RED, sha("a")),
    merged(904, PR_MERGED_GREEN, sha("b")),
    // An earlier merge of the same card that landed red on master (A13 — reported, judged by the newest).
    merged(913, PR_MERGED_GREEN, sha("f"), { mergedAt: "2026-10-05T09:00:00Z" }),
    merged(905, PR_WRONG_BASE, sha("c"), { baseRefName: "feature/parent" }),
    merged(906, PR_PENDING, sha("d")),
    merged(907, PR_GREEN_PLUS_OPEN, sha("e")),
    open(908, PR_GREEN_PLUS_OPEN, { body: `Follow-up.\n\nCard: ${PR_GREEN_PLUS_OPEN}` }),
    // A longer id that merely starts with PR_NOT_CODE must not link to it.
    open(909, `${PR_NOT_CODE}9`),
    open(910, PR_EXCEPTION),
    open(911, PR_DONE_OPEN),
    open(912, PR_DONE_OLD),
  ],
  branches: ["master", "feature/pr-901", `feature/${PR_BRANCH_ONLY}`],
  check_runs: {
    // `sast` is red everywhere but is not a required check: it must not matter.
    [sha("a")]: [run("lint-typecheck", "success"), run("integration", "failure"), run("build", "success"), run("sast", "failure")],
    [sha("b")]: [run("lint-typecheck", "success"), run("integration", "success"), run("build", "success"), run("sast", "failure")],
    [sha("f")]: [run("lint-typecheck", "success"), run("integration", "success"), run("build", "failure")],
    [sha("d")]: [run("lint-typecheck", "success"), run("integration", null, "in_progress")],
    // `integration` is satisfied by a legacy commit status (requirement not app-bound).
    [sha("e")]: [run("lint-typecheck", "success"), run("build", "skipped")],
  },
  statuses: { [sha("e")]: [{ context: "integration", state: "success" }] },
};
const GH_EMPTY = join(root, "gh-empty.json");
const GH_PRS = join(root, "gh-prs.json");
const GH_DOWN = join(root, "gh-unreachable.json");
const GH_NO_PROTECTION = join(root, "gh-no-protection.json");
writeFileSync(GH_EMPTY, JSON.stringify({ repo: "fixture-owner/fixture-repo", prs: [], branches: ["master"] }));
writeFileSync(GH_PRS, JSON.stringify(GH_FIXTURE, null, 2));
writeFileSync(GH_DOWN, JSON.stringify({ repo: "fixture-owner/fixture-repo", unreachable: "connect ECONNREFUSED 192.0.2.1:443" }));
writeFileSync(
  GH_NO_PROTECTION,
  JSON.stringify({ ...GH_FIXTURE, errors: { "required checks": "HTTP 403: Resource not accessible by integration" } }),
);

// ── t_339a0d02 fixtures: R10 judges the merge's push run only ───────────────
// Live case (2026-10-09): on merge commit a48d622 (PR #120) the push run was
// green; three workflow_dispatch runs started later on the same SHA failed on
// secret-scan (full-history scan on that event) and R10 read them, so a merged
// card could not complete. The other way round, a manual run could "repair" a
// red merge. Check runs carry their check suite; the workflow runs of the SHA
// say which suite is the `push` one. A re-run of the push run is the same suite
// with a higher check-run id, so it counts.
const EV_PUSH_GREEN_DISPATCH_RED = prCard("FE-970a push run green, a later dispatch run red on the same SHA");
const EV_PUSH_RED_DISPATCH_GREEN = prCard("FE-970b push run red, a later dispatch run green on the same SHA");
const EV_PUSH_RERUN_GREEN = prCard("FE-970c push run red, then re-run green (same suite, new attempt)");
const EV_PUSH_RED_ONLY = prCard("FE-970d push run red, nothing else (non-vacuity)");
const EV_NO_PUSH_RUN = prCard("FE-970e no push run at all, only a green dispatch run");
const EV_NON_ACTIONS = prCard("FE-970f a required check from another app (no workflow run) plus a green push run");
const evRun = (name, conclusion, id, suite) => ({ ...run(name, conclusion), id, check_suite_id: suite });
const evAll = (conclusions, base, suite) =>
  [
    ["lint-typecheck", conclusions[0]],
    ["integration", conclusions[1]],
    ["build", conclusions[2]],
  ].map(([n, c], i) => evRun(n, c, base + i, suite));
const wf = (id, event, suite, attempt = 1) => ({ id, event, check_suite_id: suite, run_attempt: attempt, name: "CI" });
const GH_EVENT = join(root, "gh-event.json");
writeFileSync(
  GH_EVENT,
  JSON.stringify(
    {
      ...GH_FIXTURE,
      prs: [
        merged(941, EV_PUSH_GREEN_DISPATCH_RED, sha("1")),
        merged(942, EV_PUSH_RED_DISPATCH_GREEN, sha("2")),
        merged(943, EV_PUSH_RERUN_GREEN, sha("3")),
        merged(944, EV_PUSH_RED_ONLY, sha("4")),
        merged(945, EV_NO_PUSH_RUN, sha("5")),
        merged(946, EV_NON_ACTIONS, sha("6")),
      ],
      check_runs: {
        // push suite 11 green; dispatch suite 12 (higher ids, i.e. newer) red on build.
        [sha("1")]: [...evAll(["success", "success", "success"], 100, 11), ...evAll(["success", "success", "failure"], 200, 12)],
        // push suite 21 red on integration; dispatch suite 22 (newer) all green.
        [sha("2")]: [...evAll(["success", "failure", "success"], 100, 21), ...evAll(["success", "success", "success"], 200, 22)],
        // push suite 31: attempt 1 red on build (id 102), re-run attempt 2 green (id 302), same suite.
        [sha("3")]: [...evAll(["success", "success", "failure"], 100, 31), evRun("build", "success", 302, 31)],
        [sha("4")]: evAll(["success", "failure", "success"], 100, 41),
        [sha("5")]: evAll(["success", "success", "success"], 100, 52),
        // `build` comes from a check suite that no workflow run owns (another app): judged as before.
        [sha("6")]: [...evAll(["success", "success", "success"], 100, 61).slice(0, 2), evRun("build", "success", 400, 69)],
      },
      statuses: {},
      workflow_runs: {
        [sha("1")]: [wf(1001, "push", 11), wf(1002, "workflow_dispatch", 12)],
        [sha("2")]: [wf(2001, "push", 21), wf(2002, "workflow_dispatch", 22)],
        [sha("3")]: [wf(3001, "push", 31, 2)],
        [sha("4")]: [wf(4001, "push", 41)],
        [sha("5")]: [wf(5002, "workflow_dispatch", 52)],
        [sha("6")]: [wf(6001, "push", 61)],
      },
    },
    null,
    2,
  ),
);

// ── t_7e8bf917 fixtures: a PR links a card only by declaration ──────────────
// Before this fix any mention of the id in a PR title/body/head linked the PR:
// live, PR #114 (which only quotes t_75180b28 in a fixture) was named by R9 on
// t_75180b28, and a merged PR that merely mentions a card satisfied R9 for it.
// Declarative = head branch named after the card, or a body line
// `Closes <id>` / `Card: <id>` / `Task: <id>` outside code; any other mention is
// the advisory A14_PR_MENTIONS_CARD — never a link, never R9 either way.
const DECLARED_CODE = "**Test Types:** unit\n**Deliverable:** code";
const LK_PROSE_MERGED = prCard("FE-960a code card: the only merged PR mentions it in prose", { body: DECLARED_CODE });
const LK_PROSE_OPEN = prCard("DOC-960b an open foreign PR mentions the card in prose (live #114 shape)");
const LK_CLOSES = prCard("FE-960c merged PR declares `Closes <id>`");
const LK_FENCE = prCard("FE-960d the only PR quotes `Closes <id>` inside a code fence / span", { body: DECLARED_CODE });
const LK_HEAD = prCard("FE-960e merged PR whose head branch is named after the card, no id in body");
const LK_TASK_BOLD = prCard("FE-960f merged PR declares `- **Task:** <id>` in a list of ids");
const LK_CLOSES_PROSE = prCard("FE-960g `Closes` followed by prose, the id later on the line / in a quote", { body: DECLARED_CODE });
const LK_OWN_PLUS_FOREIGN = prCard("FE-960h own merged PR + a foreign open PR that mentions the card");
const LK_TITLE_ONLY = prCard("FE-960i merged PR names the card only in its title", { body: DECLARED_CODE });
const GH_LINK = join(root, "gh-link.json");
writeFileSync(
  GH_LINK,
  JSON.stringify(
    {
      ...GH_FIXTURE,
      prs: [
        merged(921, LK_PROSE_MERGED, sha("b"), { body: `Follow-up raised during the review of ${LK_PROSE_MERGED}; ships nothing for it.` }),
        open(922, LK_PROSE_OPEN, { body: `Fixes the exception key. The fixture quotes the comment of ${LK_PROSE_OPEN} verbatim.`, headRefName: "qa/t_0000aaaa-exception" }),
        merged(923, LK_CLOSES, sha("b"), { body: `Summary of the change.\n\nCloses ${LK_CLOSES}` }),
        merged(924, LK_FENCE, sha("b"), {
          body: `How to link:\n\n\`\`\`\nCloses ${LK_FENCE}\n\`\`\`\n\nor inline: \`Closes ${LK_FENCE}\`\n\n    Task: ${LK_FENCE}\n`,
        }),
        merged(925, LK_HEAD, sha("b"), { body: "No id here.", headRefName: `qa/${LK_HEAD}-declarative-link` }),
        merged(926, LK_TASK_BOLD, sha("b"), { body: `Two cards.\n\n- **Task:** t_0000bbbb (BE-1), **${LK_TASK_BOLD}** (BE-2)` }),
        merged(927, LK_CLOSES_PROSE, sha("b"), { body: `Closes the gap found in ${LK_CLOSES_PROSE}.\n\n> Closes ${LK_CLOSES_PROSE}` }),
        merged(928, LK_OWN_PLUS_FOREIGN, sha("b"), { body: "Own PR.", headRefName: `feature/${LK_OWN_PLUS_FOREIGN}` }),
        open(929, LK_OWN_PLUS_FOREIGN, { body: `Unrelated fix; see ${LK_OWN_PLUS_FOREIGN} for context.`, headRefName: "fix/other" }),
        merged(930, LK_TITLE_ONLY, sha("b"), { title: `feat: something (${LK_TITLE_ONLY})`, body: "No declaration." }),
      ],
      branches: ["master"],
    },
    null,
    2,
  ),
);

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
      `INSERT INTO task_comments (task_id,author,body,created_at) VALUES ('${c.tid}','${esc(cm.author)}','${esc(body)}',${EPOCH_AFTER + (cm.at ?? i)});`,
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
        // Hermetic GitHub too (t_75180b28): every case reads an empty, reachable
        // GitHub fixture unless it passes its own — the selftest never calls `gh`.
        QA_GATE_GITHUB: "",
        QA_GATE_GH_REPO: "",
        QA_GATE_GITHUB_FIXTURE: GH_EMPTY,
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
  ["non-vacuity control: the marker comment authored by qa", QA_MARKER_AUTHOR],
  ["qa-authored loose verdict (unchanged)", LOOSE_QA],
  ["non-QA run-metadata verdict accepted (§3 row 3, A8 only)", NONQA_RUN_METADATA],
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

console.log("\n1c. t_99e408c5 regressions (R5 adjudicates claims, not citations):");
{
  const quoted = gateJson(QUOTED_PATH_REPORT);
  const cited = quoted.parsed ? quoted.parsed.facts.evidence.filter((e) => e.value.includes(CITED_ABSENT)) : [];
  check(
    "a verdict quoting another card's missing path is NOT blocked by R5 (the reported instance)",
    quoted.code === 0 &&
      quoted.parsed !== null &&
      !violationRules(quoted).includes("R5_EVIDENCE_FILE_MISSING") &&
      !violationRules(quoted).includes("R4_EVIDENCE_MISSING"),
    `exit=${quoted.code} rules=[${violationRules(quoted).join(",")}] adv=[${advisoryRules(quoted).join(",")}]`,
  );
  check(
    "the quoted path is reported as A6_EVIDENCE_CITED (the audit still sees it)",
    advisoryRules(quoted).includes("A6_EVIDENCE_CITED") && cited.length >= 1 && cited.every((e) => e.scope === "citation"),
    `adv=[${advisoryRules(quoted).join(",")}] cited=${JSON.stringify(cited.map((e) => [e.value, e.scope]))}`,
  );
  check(
    "the reporting card's own labelled evidence stays the claim it resolves",
    quoted.parsed
      ? quoted.parsed.facts.evidence.some((e) => e.value.includes(QUOTED_PATH_REPORT) && e.scope === "claim" && e.exists === true)
      : false,
    `evidence=${JSON.stringify(quoted.parsed ? quoted.parsed.facts.evidence.map((e) => [e.value, e.scope, e.exists]) : null)}`,
  );

  const present = gateJson(QUOTED_PATH_PRESENT);
  check(
    "citing another card's artifact that exists produces no R5 and no A6 noise",
    present.code === 0 &&
      !violationRules(present).includes("R5_EVIDENCE_FILE_MISSING") &&
      !advisoryRules(present).includes("A6_EVIDENCE_CITED") &&
      !advisoryRules(present).includes("A4_EVIDENCE_OFF_TREE"),
    `exit=${present.code} adv=[${advisoryRules(present).join(",")}]`,
  );

  const noLabelSpan = gateJson(NOLABEL_CODESPAN_MISSING);
  check(
    "no label: a quoted path in a code span is a citation (no R5, A6 fires)",
    noLabelSpan.code === 0 &&
      !violationRules(noLabelSpan).includes("R5_EVIDENCE_FILE_MISSING") &&
      advisoryRules(noLabelSpan).includes("A6_EVIDENCE_CITED"),
    `exit=${noLabelSpan.code} rules=[${violationRules(noLabelSpan).join(",")}] adv=[${advisoryRules(noLabelSpan).join(",")}]`,
  );

  // Anti-degradation controls: a *claimed* path that does not exist must still
  // fail R5, labelled or not, code span or not.
  expectRule("labelled evidence file missing (R5 control)", LABELLED_MISSING, "R5_EVIDENCE_FILE_MISSING", {
    forbid: ["R1_QA_VERDICT_MISSING", "R4_EVIDENCE_MISSING"],
  });
  expectRule(
    "labelled evidence file missing inside a code span is still a claim (R5 control)",
    LABELLED_MISSING_CODESPAN,
    "R5_EVIDENCE_FILE_MISSING",
    { forbid: ["R1_QA_VERDICT_MISSING", "R4_EVIDENCE_MISSING"] },
  );
  expectRule(
    "no label: a missing path in plain prose is still a claim (R5 control)",
    NOLABEL_PROSE_MISSING,
    "R5_EVIDENCE_FILE_MISSING",
    { forbid: ["R1_QA_VERDICT_MISSING", "R4_EVIDENCE_MISSING"] },
  );
}

console.log("\n1d. t_338f47fd regressions (VERDICT_MARKER_RE had no author check):");
{
  const nonQa = gateJson(NONQA_MARKER_AUTHOR);
  check(
    "(a) the marker comment authored by architect does NOT satisfy R1",
    nonQa.code === 1 && violationRules(nonQa).includes("R1_QA_VERDICT_MISSING"),
    `exit=${nonQa.code} rules=[${violationRules(nonQa).join(",")}]`,
  );
  check(
    "(a) no verdict is collected from it at all — R2/R3 cannot fire off it either",
    nonQa.parsed !== null && nonQa.parsed.facts.verdict === null,
    `verdict=${nonQa.parsed && JSON.stringify(nonQa.parsed.facts.verdict)}`,
  );
  check(
    "(a) the discounted marker is reported as A7_VERDICT_AUTHOR_IGNORED, never dropped silently",
    advisoryRules(nonQa).includes("A7_VERDICT_AUTHOR_IGNORED") &&
      nonQa.parsed.facts.discounted_verdicts.ignored.some((x) => x.author === "architect"),
    `adv=[${advisoryRules(nonQa).join(",")}] discounted=${JSON.stringify(nonQa.parsed && nonQa.parsed.facts.discounted_verdicts)}`,
  );

  const qaAuthored = gateJson(QA_MARKER_AUTHOR);
  check(
    "(b) the SAME comment authored by qa does satisfy R1 (non-vacuity control)",
    qaAuthored.code === 0 &&
      qaAuthored.parsed !== null &&
      qaAuthored.parsed.facts.verdict === "pass" &&
      violationRules(qaAuthored).length === 0,
    `exit=${qaAuthored.code} verdict=${qaAuthored.parsed && qaAuthored.parsed.facts.verdict} rules=[${violationRules(qaAuthored).join(",")}]`,
  );

  const blocked = gateJson(NONQA_BLOCKED_MARKER);
  check(
    "a non-QA `blocked` marker cannot create R3 on a done card",
    blocked.code === 1 &&
      !violationRules(blocked).includes("R3_VERDICT_NOT_TERMINAL") &&
      violationRules(blocked).includes("R1_QA_VERDICT_MISSING"),
    `exit=${blocked.code} rules=[${violationRules(blocked).join(",")}]`,
  );

  const deferral = gateJson(NONQA_DEFERRAL);
  check(
    "a non-QA `deferred` marker is not a deferral: R1 fires, R8 must not",
    deferral.code === 1 &&
      deferral.parsed !== null &&
      deferral.parsed.facts.deferral === null &&
      violationRules(deferral).includes("R1_QA_VERDICT_MISSING") &&
      !violationRules(deferral).includes("R8_DEFERRAL_TARGET_INVALID"),
    `exit=${deferral.code} deferral=${JSON.stringify(deferral.parsed && deferral.parsed.facts.deferral)} rules=[${violationRules(deferral).join(",")}]`,
  );

  const liveShape = gateJson(NONQA_MARKERS_LIVE_SHAPE);
  check(
    "live thread shape (architect deferral + dashboard verdict marker) records no verdict",
    liveShape.code === 1 &&
      liveShape.parsed !== null &&
      violationRules(liveShape).includes("R1_QA_VERDICT_MISSING") &&
      !violationRules(liveShape).includes("R8_DEFERRAL_TARGET_INVALID") &&
      advisoryRules(liveShape).filter((r) => r === "A7_VERDICT_AUTHOR_IGNORED").length === 2,
    `exit=${liveShape.code} rules=[${violationRules(liveShape).join(",")}] adv=[${advisoryRules(liveShape).join(",")}]`,
  );

  // ── AC 1c: the two sources the author rule must NOT change ────────────────
  const looseNonQa = gateJson(LOOSE_NONQA);
  check(
    "(c) loose path unchanged: a non-QA `verdict: …` is still ignored (already was) and is not a marker (no A7)",
    looseNonQa.code === 1 &&
      violationRules(looseNonQa).includes("R1_QA_VERDICT_MISSING") &&
      !advisoryRules(looseNonQa).includes("A7_VERDICT_AUTHOR_IGNORED"),
    `exit=${looseNonQa.code} rules=[${violationRules(looseNonQa).join(",")}] adv=[${advisoryRules(looseNonQa).join(",")}]`,
  );
  const meta = gateJson(NONQA_RUN_METADATA);
  check(
    "(c) run metadata unchanged: a non-QA run-metadata verdict is still accepted (A8 reports it)",
    meta.code === 0 &&
      meta.parsed !== null &&
      meta.parsed.facts.verdict === "pass" &&
      advisoryRules(meta).includes("A8_VERDICT_SELF_DECLARED"),
    `exit=${meta.code} verdict=${meta.parsed && meta.parsed.facts.verdict} adv=[${advisoryRules(meta).join(",")}]`,
  );
  const metaQa = gateJson(QA_OWN);
  check(
    "(c) a qa run-metadata verdict raises no A8 (the advisory is specific to a non-QA declaration)",
    !advisoryRules(metaQa).includes("A8_VERDICT_SELF_DECLARED"),
    `adv=[${advisoryRules(metaQa).join(",")}]`,
  );
}

console.log("\n1e. t_df8e644a regressions (a cited file name must not read as a verdict token):");
{
  // The defect: `VERDICT_LOOSE_RE` accepted `-`/`—` as separators, so the file
  // name `QA-VERDICT-ROTATION.md` was parsed as the token "rotation". The three
  // shapes below must all stop producing a token — the separator, not the
  // surrounding markup, is what distinguishes a file name from a record.
  for (const [shape, tid] of [
    ["plain prose", CITED_PATH_PLAIN],
    ["a code span", CITED_PATH_CODESPAN],
    ["a fenced block", CITED_PATH_FENCE],
  ]) {
    const res = gateJson(tid);
    check(
      `t_df8e644a: a cited file name in ${shape} yields NO verdict token (R2 must not fire)`,
      res.code === 1 &&
        res.parsed !== null &&
        res.parsed.facts.verdict === null &&
        res.parsed.facts.invalid_verdicts.length === 0 &&
        !violationRules(res).includes("R2_QA_VERDICT_INVALID"),
      `exit=${res.code} verdict=${res.parsed && JSON.stringify(res.parsed.facts.verdict)} invalid=${JSON.stringify(res.parsed && res.parsed.facts.invalid_verdicts)} rules=[${violationRules(res).join(",")}]`,
    );
  }
  // …and the citation-only cards are still evaluated (R1 is not vacuously absent).
  expectRule("t_df8e644a: the citation-only card is still judged — no verdict, so R1", CITED_PATH_PLAIN, "R1_QA_VERDICT_MISSING", {
    forbid: ["R2_QA_VERDICT_INVALID"],
  });

  const citedWithVerdict = gateJson(CITED_PATH_WITH_VERDICT);
  check(
    "t_df8e644a: the live shape — a compliant verdict citing the same file name stays clean (no R2, no R5)",
    citedWithVerdict.code === 0 &&
      citedWithVerdict.parsed !== null &&
      citedWithVerdict.parsed.facts.verdict === "pass" &&
      violationRules(citedWithVerdict).length === 0,
    `exit=${citedWithVerdict.code} verdict=${citedWithVerdict.parsed && citedWithVerdict.parsed.facts.verdict} rules=[${violationRules(citedWithVerdict).join(",")}]`,
  );

  // The masked-record half: the citation precedes the comment's real verdict, and
  // the loose path reports one match only — so before the fix this comment lost
  // its own verdict and gained a phantom one.
  const citedLooseVerdict = gateJson(CITED_PATH_LOOSE_VERDICT);
  check(
    "t_df8e644a: a cited file name before the real loose verdict no longer masks it (R1/R2 must not fire)",
    citedLooseVerdict.code === 0 &&
      citedLooseVerdict.parsed !== null &&
      citedLooseVerdict.parsed.facts.verdict === "pass" &&
      citedLooseVerdict.parsed.facts.invalid_verdicts.length === 0 &&
      violationRules(citedLooseVerdict).length === 0,
    `exit=${citedLooseVerdict.code} verdict=${citedLooseVerdict.parsed && citedLooseVerdict.parsed.facts.verdict} invalid=${JSON.stringify(citedLooseVerdict.parsed && citedLooseVerdict.parsed.facts.invalid_verdicts)} rules=[${violationRules(citedLooseVerdict).join(",")}]`,
  );

  // Anti-degradation: the loose path must keep reading real records. A colon is
  // what makes a record (§5.1 `QA-VERDICT: <token>`), and the two records the
  // fix must NOT silence are a genuine verdict and a genuine defect report.
  const genuineLoose = gateJson(LOOSE_QA);
  check(
    "t_df8e644a: anti-degradation — a genuine loose `verdict: pass` is still read (non-vacuity)",
    genuineLoose.code === 0 &&
      genuineLoose.parsed !== null &&
      genuineLoose.parsed.facts.verdict === "pass" &&
      violationRules(genuineLoose).length === 0,
    `exit=${genuineLoose.code} verdict=${genuineLoose.parsed && genuineLoose.parsed.facts.verdict} rules=[${violationRules(genuineLoose).join(",")}]`,
  );
  expectRule(
    "t_df8e644a: anti-degradation — an off-vocabulary loose token that IS the verdict still fires R2",
    LOOSE_OFFVOCAB,
    "R2_QA_VERDICT_INVALID",
    { forbid: ["R4_EVIDENCE_MISSING"] },
  );
  expectRule(
    "t_df8e644a: anti-degradation — a loose verdict claiming a missing evidence file still fires R5",
    LOOSE_MISSING_EVIDENCE,
    "R5_EVIDENCE_FILE_MISSING",
    { forbid: ["R1_QA_VERDICT_MISSING", "R4_EVIDENCE_MISSING"] },
  );

  // t_c015bda7 — R2 must follow R5's operative-verdict rule. The two directions
  // are asserted as a pair: healing forward is allowed, masking backward is not.
  const healed = gateJson(INVALID_THEN_VALID);
  check(
    "t_c015bda7: an invalid token superseded by a later valid verdict passes, with A9 recorded",
    healed.code === 0 &&
      healed.parsed !== null &&
      healed.parsed.facts.verdict === "pass" &&
      violationRules(healed).length === 0 &&
      advisoryRules(healed).includes("A9_VERDICT_SUPERSEDED"),
    `exit=${healed.code} verdict=${healed.parsed && healed.parsed.facts.verdict} rules=[${violationRules(healed).join(",")}] adv=[${advisoryRules(healed).join(",")}]`,
  );
  expectRule(
    "t_c015bda7: anti-degradation — a valid verdict followed by an invalid one still fires R2",
    VALID_THEN_INVALID,
    "R2_QA_VERDICT_INVALID",
  );
  // `forbid` on expectRule only inspects violations, so the advisory has to be
  // asserted separately: an invalid token that nothing supersedes must NOT be
  // downgraded to A9.
  const masked = gateJson(VALID_THEN_INVALID);
  check(
    "t_c015bda7: a trailing invalid token is not downgraded to an advisory",
    masked.code === 1 &&
      violationRules(masked).includes("R2_QA_VERDICT_INVALID") &&
      !advisoryRules(masked).includes("A9_VERDICT_SUPERSEDED"),
    `exit=${masked.code} rules=[${violationRules(masked).join(",")}] adv=[${advisoryRules(masked).join(",")}]`,
  );
}

console.log("\n1f. t_b8001b55 regressions (qa-signoff-exception: author allowlist, quotes, security track):");
{
  const a10 = (res) => (res.parsed ? res.parsed.advisories.filter((a) => a.rule === "A10_EXCEPTION_IGNORED") : []);
  const why = (res) => (res.parsed ? (res.parsed.facts.exceptions_ignored || []).map((x) => x.why) : []);
  const op = (res) => (res.parsed ? res.parsed.facts.exception : undefined);

  // (1) non-allowed authors are ignored, with an advisory — the waiver is gone.
  for (const [label, tid, author] of [
    ["an executing profile (backend)", EXC_BY_BACKEND, "backend"],
    ["the anonymous `worker` author", EXC_BY_WORKER, "worker"],
  ]) {
    const r = gateJson(tid);
    check(
      `(1) exception by ${label} → ignored: R1 + R4 fire, A10(author), no X1`,
      r.code === 1 &&
        violationRules(r).includes("R1_QA_VERDICT_MISSING") &&
        violationRules(r).includes("R4_EVIDENCE_MISSING") &&
        op(r) === null &&
        why(r).join() === "author" &&
        a10(r).some((a) => a.detail.includes(`"${author}"`)) &&
        !advisoryRules(r).includes("X1_EXCEPTION"),
      `exit=${r.code} rules=[${violationRules(r).join(",")}] adv=[${advisoryRules(r).join(",")}] why=[${why(r).join(",")}]`,
    );
  }
  const w = gateJson(EXC_BY_WORKER);
  check(
    "(1) the `worker` refusal says it names no profile",
    a10(w).some((a) => /names no profile/.test(a.detail)),
    `adv=${JSON.stringify(a10(w).map((a) => a.detail))}`,
  );

  // (2) a quoted key is a citation, not an exception — the live #551 record first.
  for (const [label, tid] of [
    ["live t_75180b28 #551 (backtick quotes, architect)", EXC_QUOTED_LIVE],
    ["fenced block (architect)", EXC_QUOTED_FENCE],
  ]) {
    const r = gateJson(tid);
    check(
      `(2) key quoted in ${label} → ignored: R1 fires, A10(quoted), no X1`,
      r.code === 1 &&
        violationRules(r).includes("R1_QA_VERDICT_MISSING") &&
        op(r) === null &&
        why(r).join() === "quoted" &&
        !advisoryRules(r).includes("X1_EXCEPTION"),
      `exit=${r.code} rules=[${violationRules(r).join(",")}] adv=[${advisoryRules(r).join(",")}] why=[${why(r).join(",")}]`,
    );
  }
  const qr = gateJson(EXC_QUOTED_THEN_REAL);
  check(
    "(2) non-vacuity: a quote plus a real key in the same comment → the real one is operative",
    qr.code === 0 &&
      violationRules(qr).length === 0 &&
      op(qr) && /INC-002/.test(op(qr).reason) &&
      advisoryRules(qr).includes("X1_EXCEPTION") &&
      why(qr).length === 0,
    `exit=${qr.code} rules=[${violationRules(qr).join(",")}] exc=${JSON.stringify(op(qr))}`,
  );
  const ra = gateJson(EXC_REFUSED_THEN_ALLOWED);
  check(
    "(2) a refused record first does not shadow a later allowed one (no first-match trap)",
    ra.code === 0 && op(ra) && op(ra).author === "architect" && why(ra).join() === "author",
    `exit=${ra.code} exc=${JSON.stringify(op(ra))} why=[${why(ra).join(",")}]`,
  );

  // (3) security track: no author can waive AR-6 — R7 AND R1 still fire.
  const sec = gateJson(EXC_SECURITY);
  check(
    "(3) security-track card with exceptions by dashboard/architect/qa → R7 AND R1 (and R4) still fire",
    sec.code === 1 &&
      sec.parsed.facts.security_track === true &&
      ["R7_SECURITY_TRACK_SIGNOFF_MISSING", "R1_QA_VERDICT_MISSING", "R4_EVIDENCE_MISSING"].every((x) => violationRules(sec).includes(x)) &&
      op(sec) === null &&
      why(sec).join() === "security-track,security-track,security-track" &&
      !advisoryRules(sec).includes("X1_EXCEPTION"),
    `exit=${sec.code} rules=[${violationRules(sec).join(",")}] why=[${why(sec).join(",")}]`,
  );
  const secHook = runGate(
    ["hook", "--db", db],
    JSON.stringify({
      hook_event_name: "pre_tool_call",
      tool_name: "kanban_complete",
      tool_input: { task_id: EXC_SECURITY, summary: "done" },
      session_id: "sess_fixture",
      cwd: repo,
    }),
    { HERMES_KANBAN_DB: db, HERMES_HOME: root },
  );
  check(
    "(3) hook mode blocks completing the security-track card despite the exceptions",
    secHook.code === 2 && /R7_SECURITY_TRACK_SIGNOFF_MISSING/.test(secHook.out),
    `exit=${secHook.code} out=${secHook.out.slice(0, 200).replace(/\n/g, " ")}`,
  );

  // (4) non-vacuity: an allowed author on a non-security card still waives.
  for (const [author, tid] of Object.entries(EXC_ALLOWED)) {
    const r = gateJson(tid);
    check(
      `(4) non-vacuity: exception by ${author} on a non-security card → still valid (0 violations, X1, no A10)`,
      r.code === 0 &&
        violationRules(r).length === 0 &&
        op(r) && op(r).author === author &&
        advisoryRules(r).includes("X1_EXCEPTION") &&
        !advisoryRules(r).includes("A10_EXCEPTION_IGNORED"),
      `exit=${r.code} rules=[${violationRules(r).join(",")}] adv=[${advisoryRules(r).join(",")}]`,
    );
  }
}

console.log("\n1g. t_b2588ee7 regressions (a qa-signoff-exception can be withdrawn by a later record):");
{
  const op = (res) => (res.parsed ? res.parsed.facts.exception : undefined);
  const wd = (res) => (res.parsed ? res.parsed.facts.exceptions_withdrawn || [] : []);
  const wIg = (res) => (res.parsed ? (res.parsed.facts.exception_withdrawals_ignored || []).map((x) => x.why) : []);
  const a16 = (res) => (res.parsed ? res.parsed.advisories.filter((a) => a.rule === "A16_EXCEPTION_WITHDRAWAL_IGNORED") : []);
  const show = (r) =>
    `exit=${r.code} rules=[${violationRules(r).join(",")}] adv=[${advisoryRules(r).join(",")}] exc=${JSON.stringify(op(r))} wIg=[${wIg(r).join(",")}]`;
  const gone = (r) =>
    r.code === 1 &&
    op(r) === null &&
    violationRules(r).includes("R1_QA_VERDICT_MISSING") &&
    violationRules(r).includes("R4_EVIDENCE_MISSING") &&
    !advisoryRules(r).includes("X1_EXCEPTION");
  const holds = (r, author = "architect") =>
    r.code === 0 && violationRules(r).length === 0 && op(r) && op(r).author === author && advisoryRules(r).includes("X1_EXCEPTION");

  // (1) exception then withdrawal → no exception any more; the trail stays visible.
  for (const [label, tid, by] of [
    ["same author (architect → architect)", EXC_THEN_WDR, "architect"],
    ["another allowed author (dashboard → qa)", EXC_THEN_WDR_OTHER, "qa"],
  ]) {
    const r = gateJson(tid);
    check(
      `(1) exception then withdrawal by ${label} → no exception: R1 + R4 fire, X2 reported, no X1`,
      gone(r) &&
        wd(r).length === 1 &&
        wd(r)[0].withdrawn_by === by &&
        /incident is closed/.test(wd(r)[0].withdrawal_reason) &&
        advisoryRules(r).includes("X2_EXCEPTION_WITHDRAWN"),
      show(r),
    );
  }

  // (2) a withdrawal by a non-allowed author is ignored: the exception holds.
  for (const [label, tid, author] of [
    ["an executing profile (backend)", EXC_THEN_WDR_BACKEND, "backend"],
    ["the anonymous `worker` author", EXC_THEN_WDR_WORKER, "worker"],
  ]) {
    const r = gateJson(tid);
    check(
      `(2) withdrawal by ${label} → ignored: exception holds (X1, 0 violations), A16(author), no X2`,
      holds(r) &&
        wd(r).length === 0 &&
        wIg(r).join() === "author" &&
        a16(r).some((a) => a.detail.includes(`"${author}"`)) &&
        !advisoryRules(r).includes("X2_EXCEPTION_WITHDRAWN"),
      show(r),
    );
  }
  const ww = gateJson(EXC_THEN_WDR_WORKER);
  check(
    "(2) the `worker` withdrawal refusal says it names no profile",
    a16(ww).some((a) => /names no profile/.test(a.detail)),
    `adv=${JSON.stringify(a16(ww).map((a) => a.detail))}`,
  );
  const wq = gateJson(EXC_THEN_WDR_QUOTED);
  check(
    "(2) a withdrawal key quoted in a code span is a citation → ignored: exception holds, A16(quoted)",
    holds(wq) && wd(wq).length === 0 && wIg(wq).join() === "quoted",
    show(wq),
  );

  // (3) a withdrawal with no exception in force: no effect, no crash.
  const wo = gateJson(WDR_ONLY);
  check(
    "(3) withdrawal without any exception → no effect: gate runs (JSON), R1 fires as on a bare card, A16(no-exception)",
    wo.parsed !== null &&
      wo.code === 1 &&
      op(wo) === null &&
      wd(wo).length === 0 &&
      wIg(wo).join() === "no-exception" &&
      violationRules(wo).includes("R1_QA_VERDICT_MISSING") &&
      !advisoryRules(wo).includes("X1_EXCEPTION"),
    show(wo),
  );
  const woc = gateJson(WDR_ONLY_COMPLIANT);
  check(
    "(3) a bare stray withdrawal on a compliant card changes nothing (0 violations, A16 only)",
    woc.code === 0 && violationRules(woc).length === 0 && wIg(woc).join() === "no-exception" && op(woc) === null,
    show(woc),
  );
  const wbe = gateJson(WDR_BEFORE_EXC);
  check(
    "(3) a withdrawal posted BEFORE the exception does not pre-empt it (posterior records only)",
    holds(wbe) && wd(wbe).length === 0 && wIg(wbe).join() === "no-exception",
    show(wbe),
  );

  // Ordering and re-arming.
  const rearm = gateJson(EXC_WDR_EXC);
  check(
    "re-arm: exception → withdrawal → new exception → the new one is operative, the first stays visible as X2",
    holds(rearm, "human") && /INC-003/.test(op(rearm).reason) && wd(rearm).length === 1 && wd(rearm)[0].author === "architect",
    show(rearm),
  );
  const same = gateJson(EXC_WDR_SAME_COMMENT);
  check("one comment recording an exception then its withdrawal → withdrawn", gone(same) && wd(same).length === 1, show(same));
  const tie = gateJson(EXC_WDR_SAME_SECOND);
  check("same-second exception + withdrawal → posting order (id) breaks the tie → withdrawn", gone(tie) && wd(tie).length === 1, show(tie));

  // A withdrawal spelling must never be read as an exception.
  for (const tid of WDR_SHAPES_ALONE) {
    const r = gateJson(tid);
    const body = CARDS.find((c) => c.tid === tid).comments[0].body;
    check(
      `withdrawal spelling "${body.slice(0, 34)}…" alone is NOT an exception → R1 fires, no X1`,
      gone(r) && wIg(r).join() === "no-exception" && (r.parsed.facts.exceptions_ignored || []).length === 0,
      show(r),
    );
  }

  // Security track: nothing to withdraw (the exception is refused), R7 unchanged.
  const sw = gateJson(EXC_SECURITY_WDR);
  check(
    "security-track card: exception refused, withdrawal is a no-op, R7 + R1 still fire",
    sw.code === 1 &&
      ["R7_SECURITY_TRACK_SIGNOFF_MISSING", "R1_QA_VERDICT_MISSING"].every((x) => violationRules(sw).includes(x)) &&
      op(sw) === null &&
      wIg(sw).join() === "no-exception",
    show(sw),
  );

  // Hook mode: a withdrawn exception no longer lets the card complete.
  const hk = runGate(
    ["hook", "--db", db],
    JSON.stringify({
      hook_event_name: "pre_tool_call",
      tool_name: "kanban_complete",
      tool_input: { task_id: EXC_THEN_WDR, summary: "done" },
      session_id: "sess_fixture",
      cwd: repo,
    }),
    { HERMES_KANBAN_DB: db, HERMES_HOME: root },
  );
  check(
    "hook mode blocks completing a card whose exception was withdrawn",
    hk.code === 2 && /R1_QA_VERDICT_MISSING/.test(hk.out) && hk.out.includes(EXC_THEN_WDR),
    `exit=${hk.code} out=${hk.out.slice(0, 200).replace(/\n/g, " ")}`,
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

  // t_338f47fd: the defect's real impact — a non-QA marker comment satisfied the
  // fail-closed completion hook. The author is the only variable between these
  // two fires (same comment text, same board, same payload shape).
  const nonQaHook = runGate(["hook", "--db", db], payload(NONQA_MARKER_AUTHOR), { HERMES_KANBAN_DB: db });
  let nonQaDirective = null;
  try {
    nonQaDirective = JSON.parse(nonQaHook.out.split("\n")[0]);
  } catch {
    nonQaDirective = null;
  }
  check(
    "a non-QA marker comment does NOT clear the fail-closed hook (block + exit 2, reason names R1)",
    nonQaHook.code === 2 && nonQaDirective && nonQaDirective.decision === "block" && /R1_QA_VERDICT_MISSING/.test(nonQaDirective.reason),
    `exit=${nonQaHook.code} out=${nonQaHook.out.slice(0, 240).replace(/\n/g, " ")}`,
  );

  const qaHook = runGate(["hook", "--db", db], payload(QA_MARKER_AUTHOR), { HERMES_KANBAN_DB: db });
  check(
    "the same comment authored by qa still allows the completion (non-vacuity control)",
    qaHook.code === 0 && qaHook.out.trim() === "{}",
    `exit=${qaHook.code} out=${qaHook.out.trim().slice(0, 160)}`,
  );

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

console.log("\n6. PR merged into master + required CI green on the merge commit (R9/R10, t_75180b28):");
{
  const prCheck = (taskId, fixture = GH_PRS, extraArgs = []) => {
    const r = runGate(["check", "--task", taskId, "--db", db, "--repo", repo, "--pre-complete", "--json", ...extraArgs], "", {
      QA_GATE_GITHUB_FIXTURE: fixture,
    });
    let parsed = null;
    try {
      parsed = JSON.parse(r.out);
    } catch {
      parsed = null;
    }
    const v = parsed ? parsed.violations : [];
    const a = parsed ? parsed.advisories : [];
    return {
      code: r.code,
      out: r.out,
      parsed,
      rules: v.map((x) => x.rule),
      adv: a.map((x) => x.rule),
      detail: (rule) => (v.find((x) => x.rule === rule) || a.find((x) => x.rule === rule) || {}).detail || "",
      pr: parsed ? parsed.facts.pr_rule : null,
    };
  };
  const show = (r) => `exit=${r.code} rules=[${r.rules.join(",")}] adv=[${r.adv.join(",")}] out=${r.out.slice(0, 200).replace(/\n/g, " ")}`;
  const only = (r, rule) => r.code === 1 && r.rules.length === 1 && r.rules[0] === rule;

  // The four cases the card names (t_75180b28 body).
  let r = prCheck(PR_OPEN);
  check("(1) open PR → R9_PR_NOT_MERGED naming PR #901 as open", only(r, "R9_PR_NOT_MERGED") && /#901 is open/.test(r.detail("R9_PR_NOT_MERGED")), show(r));
  r = prCheck(PR_CLOSED);
  check(
    "(2) closed-unmerged PR → R9_PR_NOT_MERGED naming PR #902 as closed without merge",
    only(r, "R9_PR_NOT_MERGED") && /#902 was closed without being merged/.test(r.detail("R9_PR_NOT_MERGED")),
    show(r),
  );
  r = prCheck(PR_MERGED_RED);
  check(
    "(3) merged PR with a red required check → R10_MERGE_CI_NOT_GREEN naming PR #903 and integration=failure (never R9)",
    only(r, "R10_MERGE_CI_NOT_GREEN") && /PR #903 is merged/.test(r.detail("R10_MERGE_CI_NOT_GREEN")) && /integration=failure/.test(r.detail("R10_MERGE_CI_NOT_GREEN")),
    show(r),
  );
  check("(3b) a red check that is NOT required (sast) is not reported", !/sast/.test(r.detail("R10_MERGE_CI_NOT_GREEN")), r.detail("R10_MERGE_CI_NOT_GREEN"));
  r = prCheck(PR_MERGED_GREEN);
  check(
    "(4) merged PR, all required checks green on the merge commit → allowed (0 violations, PR #904 judged)",
    r.code === 0 && r.rules.length === 0 && r.pr && r.pr.judged_pr === 904 && Object.values(r.pr.check_states || {}).every((s) => s === "success"),
    `${show(r)} pr=${JSON.stringify(r.pr)}`,
  );
  check(
    "(4b) the required list comes from the fixture's branch protection, not a hard-coded list",
    r.pr && JSON.stringify(r.pr.required_checks) === JSON.stringify(["lint-typecheck", "integration", "build"]),
    JSON.stringify(r.pr && r.pr.required_checks),
  );
  check(
    "(4c) an earlier merge of the same card that landed red (#913, build=failure) → A13 advisory, not a violation",
    r.code === 0 && r.adv.includes("A13_EARLIER_MERGE_CI_NOT_GREEN") && /#913/.test(r.detail("A13_EARLIER_MERGE_CI_NOT_GREEN")) && /build=failure/.test(r.detail("A13_EARLIER_MERGE_CI_NOT_GREEN")),
    show(r),
  );

  // Shapes around the four cases.
  r = prCheck(PR_WRONG_BASE);
  check("PR merged into a stacked branch is not merged into master → R9 naming #905 and its base", only(r, "R9_PR_NOT_MERGED") && /#905 merged into `feature\/parent`/.test(r.detail("R9_PR_NOT_MERGED")), show(r));
  r = prCheck(PR_PENDING);
  check(
    "merge-commit CI still running / a required check missing → R10 (in_progress, missing)",
    only(r, "R10_MERGE_CI_NOT_GREEN") && /integration=in_progress/.test(r.detail("R10_MERGE_CI_NOT_GREEN")) && /build=missing/.test(r.detail("R10_MERGE_CI_NOT_GREEN")),
    show(r),
  );
  r = prCheck(PR_GREEN_PLUS_OPEN);
  check(
    "merged green PR + a second open PR → allowed, the open one reported as A12_LINKED_PR_OPEN (#908); skipped + legacy status count as green",
    r.code === 0 && r.rules.length === 0 && r.adv.includes("A12_LINKED_PR_OPEN") && /#908/.test(r.detail("A12_LINKED_PR_OPEN")) && r.pr.judged_pr === 907,
    show(r),
  );
  r = prCheck(PR_BRANCH_ONLY);
  check("branch pushed but no PR ever opened → R9 naming the branch", only(r, "R9_PR_NOT_MERGED") && r.detail("R9_PR_NOT_MERGED").includes(`feature/${PR_BRANCH_ONLY}`), show(r));
  r = prCheck(PR_DECLARED);
  check("card declares `Deliverable: code`, no PR → R9", only(r, "R9_PR_NOT_MERGED") && /Deliverable: code/.test(r.detail("R9_PR_NOT_MERGED")), show(r));
  r = prCheck(PR_NOT_CODE);
  check(
    "non-code card (no PR, no branch, no declaration; a longer id in PR #909 does not link) → rule does not apply",
    r.code === 0 && r.rules.length === 0 && r.pr && r.pr.applies === false && r.pr.linked_prs.length === 0,
    `${show(r)} pr=${JSON.stringify(r.pr)}`,
  );
  r = prCheck(PR_EXCEPTION);
  check("a §5.6 sign-off exception does not waive R9 (repository fact, not a QA record)", r.code === 1 && r.rules.includes("R9_PR_NOT_MERGED") && /#910/.test(r.detail("R9_PR_NOT_MERGED")), show(r));

  // Network degradation: advisory, never a violation (architect constraint).
  r = prCheck(PR_OPEN, GH_DOWN);
  check("GitHub unreachable → A11_CI_STATE_UNVERIFIABLE advisory, no violation (open-PR card completes)", r.code === 0 && r.rules.length === 0 && r.adv.includes("A11_CI_STATE_UNVERIFIABLE"), show(r));
  r = prCheck(PR_MERGED_RED, GH_DOWN);
  check("GitHub unreachable → red-CI card is not failed either (A11 only)", r.code === 0 && r.rules.length === 0 && r.adv.includes("A11_CI_STATE_UNVERIFIABLE"), show(r));
  r = prCheck(PR_MERGED_RED, GH_NO_PROTECTION);
  check(
    "branch protection unreadable → R10 not evaluated, A11 names the branch protection",
    r.code === 0 && r.rules.length === 0 && /branch protection/.test(r.detail("A11_CI_STATE_UNVERIFIABLE")),
    show(r),
  );
  r = prCheck(PR_OPEN, GH_NO_PROTECTION);
  check("branch protection unreadable does not disarm R9 (PR state was readable)", only(r, "R9_PR_NOT_MERGED"), show(r));
  r = prCheck(PR_OPEN, GH_PRS, ["--no-github"]);
  check("--no-github → A11, no violation", r.code === 0 && r.rules.length === 0 && r.adv.includes("A11_CI_STATE_UNVERIFIABLE"), show(r));

  // Audit mode: the after-the-fact detection of a CLI completion (architect Q1).
  const audit = runGate(["audit", "--db", db, "--repo", repo, "--json"], "", { QA_GATE_GITHUB_FIXTURE: GH_PRS });
  let parsed = null;
  try {
    parsed = JSON.parse(audit.out);
  } catch {
    parsed = null;
  }
  const res = (id) => (parsed ? parsed.results.find((x) => x.facts.task_id === id) : null);
  const late = res(PR_DONE_OPEN);
  const old = res(PR_DONE_OLD);
  check(
    "audit: a card completed (e.g. via `hermes kanban complete`) after the rule epoch with an open PR → R9 FAIL, exit 1",
    audit.code === 1 && late && late.violations.some((v) => v.rule === "R9_PR_NOT_MERGED" && /#911/.test(v.detail)),
    `exit=${audit.code} late=${JSON.stringify(late && late.violations)}`,
  );
  check(
    "audit: a card completed before the rule epoch is not re-judged (no lookup, no R9)",
    old && old.violations.length === 0 && old.facts.pr_rule && old.facts.pr_rule.in_scope === false,
    JSON.stringify(old && { v: old.violations, pr: old.facts.pr_rule }),
  );

  // Hook mode: what an agent actually hits on kanban_complete.
  const hookPayload = (taskId) =>
    JSON.stringify({ hook_event_name: "pre_tool_call", tool_name: "kanban_complete", tool_input: { task_id: taskId }, cwd: repo, extra: {} });
  const hook = (taskId, fixture = GH_PRS) => {
    const h = runGate(["hook", "--db", db], hookPayload(taskId), { HERMES_KANBAN_DB: db, QA_GATE_GITHUB_FIXTURE: fixture });
    let d = null;
    try {
      d = JSON.parse(h.out.split("\n")[0]);
    } catch {
      d = null;
    }
    return { code: h.code, out: h.out, reason: d && d.reason ? d.reason : "" };
  };
  let h = hook(PR_OPEN);
  check(
    "hook: open PR → block (exit 2) with R9, PR #901, and the review→merger path — no misleading 'record the verdict' line",
    h.code === 2 && /R9_PR_NOT_MERGED/.test(h.reason) && /#901/.test(h.reason) && /merger/.test(h.reason) && !/Record the verdict/.test(h.reason),
    `exit=${h.code} reason=${h.reason.slice(0, 300).replace(/\n/g, " ")}`,
  );
  h = hook(PR_MERGED_RED);
  check("hook: merged PR with red CI → block with R10 and PR #903", h.code === 2 && /R10_MERGE_CI_NOT_GREEN/.test(h.reason) && /#903/.test(h.reason), `exit=${h.code} reason=${h.reason.slice(0, 200)}`);
  h = hook(PR_MERGED_GREEN);
  check("hook: merged PR with green CI → {} + exit 0", h.code === 0 && h.out.trim() === "{}", `exit=${h.code} out=${h.out.slice(0, 200)}`);
  h = hook(PR_OPEN, GH_DOWN);
  check("hook: GitHub unreachable → allowed (A11 is advisory, never a block)", h.code === 0 && h.out.trim() === "{}", `exit=${h.code} out=${h.out.slice(0, 200)}`);
}

console.log("\n7. A PR links a card only by declaration — head branch or `Closes`/`Card:`/`Task:` line (§5.9, t_7e8bf917):");
{
  const prCheck = (taskId, fixture = GH_LINK) => {
    const r = runGate(["check", "--task", taskId, "--db", db, "--repo", repo, "--pre-complete", "--json"], "", { QA_GATE_GITHUB_FIXTURE: fixture });
    let parsed = null;
    try {
      parsed = JSON.parse(r.out);
    } catch {
      parsed = null;
    }
    const v = parsed ? parsed.violations : [];
    const a = parsed ? parsed.advisories : [];
    return {
      code: r.code,
      out: r.out,
      rules: v.map((x) => x.rule),
      adv: a.map((x) => x.rule),
      detail: (rule) => (v.find((x) => x.rule === rule) || a.find((x) => x.rule === rule) || {}).detail || "",
      pr: parsed ? parsed.facts.pr_rule : null,
    };
  };
  const show = (r) => `exit=${r.code} rules=[${r.rules.join(",")}] adv=[${r.adv.join(",")}] pr=${JSON.stringify(r.pr).slice(0, 300)}`;
  const linkedNums = (r) => (r.pr && Array.isArray(r.pr.linked_prs) ? r.pr.linked_prs.map((p) => p.number) : null);
  const mentionNums = (r) => (r.pr && Array.isArray(r.pr.mentioning_prs) ? r.pr.mentioning_prs.map((p) => p.number) : null);

  // AC 3 — the four cases the card names.
  let r = prCheck(LK_PROSE_MERGED);
  check(
    "(1) prose mention only → no link: a merged PR #921 that merely mentions the card does NOT satisfy R9 (Deliverable: code → R9) and is reported as A14_PR_MENTIONS_CARD",
    r.code === 1 && r.rules.length === 1 && r.rules[0] === "R9_PR_NOT_MERGED" && JSON.stringify(linkedNums(r)) === "[]" && r.adv.includes("A14_PR_MENTIONS_CARD") && /#921/.test(r.detail("A14_PR_MENTIONS_CARD")),
    show(r),
  );
  r = prCheck(LK_CLOSES);
  check(
    "(2) `Closes <id>` line in the body → linked: PR #923 judged, allowed, no A14",
    r.code === 0 && r.rules.length === 0 && r.pr && r.pr.judged_pr === 923 && JSON.stringify(linkedNums(r)) === "[923]" && !r.adv.includes("A14_PR_MENTIONS_CARD"),
    show(r),
  );
  r = prCheck(LK_FENCE);
  check(
    "(3) `Closes <id>` / `Task: <id>` only inside a code fence, an inline code span or an indented code block → no link (R9 on the Deliverable: code card) + A14 naming #924",
    r.code === 1 && r.rules.length === 1 && r.rules[0] === "R9_PR_NOT_MERGED" && JSON.stringify(linkedNums(r)) === "[]" && /#924/.test(r.detail("A14_PR_MENTIONS_CARD")),
    show(r),
  );
  r = prCheck(LK_HEAD);
  check(
    "(4) head branch named after the card (id absent from title and body) → linked: PR #925 judged, allowed",
    r.code === 0 && r.rules.length === 0 && r.pr && r.pr.judged_pr === 925 && r.pr.linked_prs[0] && r.pr.linked_prs[0].link === "head-branch",
    show(r),
  );

  // AC 4 at fixture level — the live #114 shape on t_75180b28.
  r = prCheck(LK_PROSE_OPEN);
  check(
    "live #114 shape: an open foreign PR (#922) that quotes the card in prose → not linked, no R9 naming it, card out of scope; A14 keeps it visible",
    r.code === 0 && r.rules.length === 0 && r.pr && r.pr.applies === false && JSON.stringify(linkedNums(r)) === "[]" && JSON.stringify(mentionNums(r)) === "[922]" && /#922/.test(r.detail("A14_PR_MENTIONS_CARD")),
    show(r),
  );
  r = prCheck(LK_OWN_PLUS_FOREIGN);
  check(
    "own merged PR (#928, head branch) + foreign open PR mentioning the card (#929) → allowed, A14 for #929 and NO A12 (it is not linked)",
    r.code === 0 && r.rules.length === 0 && r.pr.judged_pr === 928 && JSON.stringify(linkedNums(r)) === "[928]" && !r.adv.includes("A12_LINKED_PR_OPEN") && /#929/.test(r.detail("A14_PR_MENTIONS_CARD")),
    show(r),
  );

  // Shapes around the vocabulary.
  r = prCheck(LK_TASK_BOLD);
  check(
    "`- **Task:** t_a (BE-1), **<id>** (BE-2)` — bold bullet, list of ids → linked (#926 judged)",
    r.code === 0 && r.rules.length === 0 && r.pr && r.pr.judged_pr === 926 && r.pr.linked_prs[0].link === "body-declaration",
    show(r),
  );
  r = prCheck(LK_CLOSES_PROSE);
  check(
    "`Closes the gap found in <id>.` and a quoted `> Closes <id>` → not a declaration (R9 + A14 for #927)",
    r.code === 1 && r.rules.length === 1 && r.rules[0] === "R9_PR_NOT_MERGED" && JSON.stringify(linkedNums(r)) === "[]" && /#927/.test(r.detail("A14_PR_MENTIONS_CARD")),
    show(r),
  );
  r = prCheck(LK_TITLE_ONLY);
  check(
    "id only in the PR title (`feat: … (<id>)`) → not a link (R9 + A14 for #930)",
    r.code === 1 && r.rules.length === 1 && r.rules[0] === "R9_PR_NOT_MERGED" && /#930/.test(r.detail("A14_PR_MENTIONS_CARD")),
    show(r),
  );
  check(
    "the R9 message tells the author how to declare the link (`Closes <id>` / head branch)",
    /Closes/.test(r.detail("R9_PR_NOT_MERGED")) && /head branch/.test(r.detail("R9_PR_NOT_MERGED")),
    r.detail("R9_PR_NOT_MERGED"),
  );
  r = prCheck(PR_NOT_CODE, GH_PRS);
  check(
    "a longer id (#909 `Closes <id>9`) is neither a link nor a mention → no A14",
    r.code === 0 && r.pr && r.pr.applies === false && !r.adv.includes("A14_PR_MENTIONS_CARD"),
    show(r),
  );
}

console.log("\n8. R10 judges the merge's push run only; manual runs on the same SHA are advisory (§5.9, t_339a0d02):");
{
  const evCheck = (taskId) => {
    const r = runGate(["check", "--task", taskId, "--db", db, "--repo", repo, "--pre-complete", "--json"], "", { QA_GATE_GITHUB_FIXTURE: GH_EVENT });
    let p = null;
    try {
      p = JSON.parse(r.out);
    } catch {
      p = null;
    }
    const v = p ? p.violations : [];
    const a = p ? p.advisories : [];
    return {
      code: r.code,
      out: r.out,
      rules: v.map((x) => x.rule),
      adv: a.map((x) => x.rule),
      detail: (rule) => (v.find((x) => x.rule === rule) || a.find((x) => x.rule === rule) || {}).detail || "",
      pr: p ? p.facts.pr_rule : null,
    };
  };
  const show = (r) => `exit=${r.code} rules=[${r.rules.join(",")}] adv=[${r.adv.join(",")}] out=${r.out.slice(0, 240).replace(/\n/g, " ")}`;

  let r = evCheck(EV_PUSH_GREEN_DISPATCH_RED);
  check(
    "(1) push run green + later dispatch run red on the same SHA → no R10, A15 naming build and the dispatch event (live a48d622 shape)",
    r.code === 0 && r.rules.length === 0 && r.adv.includes("A15_NON_PUSH_RUN_ON_MERGE_COMMIT") && /build/.test(r.detail("A15_NON_PUSH_RUN_ON_MERGE_COMMIT")) && /workflow_dispatch/.test(r.detail("A15_NON_PUSH_RUN_ON_MERGE_COMMIT")),
    show(r),
  );
  check("(1b) the judged states are the push run's (all success)", r.pr && Object.values(r.pr.check_states || {}).every((s) => s === "success"), JSON.stringify(r.pr && r.pr.check_states));
  r = evCheck(EV_PUSH_RED_DISPATCH_GREEN);
  check(
    "(2) push run red + later dispatch run green → R10 integration=failure (a manual run cannot repair a red merge), A15 present",
    r.code === 1 && r.rules.length === 1 && r.rules[0] === "R10_MERGE_CI_NOT_GREEN" && /integration=failure/.test(r.detail("R10_MERGE_CI_NOT_GREEN")) && r.adv.includes("A15_NON_PUSH_RUN_ON_MERGE_COMMIT"),
    show(r),
  );
  r = evCheck(EV_PUSH_RERUN_GREEN);
  check(
    "(3) push run red then re-run green (same suite, newer attempt) → no R10, no A15 (a re-run of the push run is the push run)",
    r.code === 0 && r.rules.length === 0 && !r.adv.includes("A15_NON_PUSH_RUN_ON_MERGE_COMMIT") && r.pr && r.pr.check_states && r.pr.check_states.build === "success",
    show(r),
  );
  r = evCheck(EV_PUSH_RED_ONLY);
  check(
    "(4) non-vacuity: push run red alone → R10 integration=failure, no A15",
    r.code === 1 && r.rules.length === 1 && r.rules[0] === "R10_MERGE_CI_NOT_GREEN" && /integration=failure/.test(r.detail("R10_MERGE_CI_NOT_GREEN")) && !r.adv.includes("A15_NON_PUSH_RUN_ON_MERGE_COMMIT"),
    show(r),
  );
  r = evCheck(EV_NO_PUSH_RUN);
  check(
    "(5) no push run on the merge commit, only a green dispatch run → R10 (fail closed: a manual run never satisfies R10), state no-push-run",
    r.code === 1 && r.rules.length === 1 && r.rules[0] === "R10_MERGE_CI_NOT_GREEN" && /no-push-run/.test(r.detail("R10_MERGE_CI_NOT_GREEN")),
    show(r),
  );
  r = evCheck(EV_NON_ACTIONS);
  check(
    "(6) a required check from a suite no workflow run owns (another app) is judged as before → allowed",
    r.code === 0 && r.rules.length === 0 && r.pr && r.pr.check_states && r.pr.check_states.build === "success",
    show(r),
  );
}

console.log("\n9. The audit counts and surfaces A11; --fail-on-a11 turns it red (t_b102b100, §5.9):");
{
  const SUMMARY = join(HERE, "signoff-audit-summary.mjs");
  // Two compliant cards completed after the PR-rule epoch: valid QA verdict +
  // evidence, no PR, no branch, no `Deliverable: code`. With a reachable
  // GitHub they are simply out of R9/R10 scope (no A11); with an unreachable
  // GitHub each carries A11 and nothing else — the "A11-only board".
  const a11Cards = [
    { tid: "t_a11a0001", title: "FE-970a A11-only: 100% compliant, title has a colon, a comma and a percent sign" },
    { tid: "t_a11a0002", title: "FE-970b A11-only second card" },
  ].map((c) => ({
    ...c,
    body: "**Test Types:** unit",
    assignee: "frontend",
    status: "done",
    completed: PR_DONE_AT,
    comments: [qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md")],
    runs: [],
    attachments: [],
  }));
  for (const c of a11Cards) fixtureFile(`tests/evidence/${c.tid}/README.md`);
  const miniDb = join(root, "board-a11.db");
  execFileSync("sqlite3", [miniDb], { input: [BOARD_SQL, ...a11Cards.map(taskRowSQL)].join("\n") });
  const ids = a11Cards.map((c) => c.tid);

  const audit = (fixture, extra = []) => {
    const jsonOut = join(root, `audit-${cases}.json`);
    const t = runGate(["audit", "--db", miniDb, "--repo", repo, "--json-out", jsonOut, ...extra], "", { QA_GATE_GITHUB_FIXTURE: fixture });
    let doc = null;
    try {
      doc = JSON.parse(readFileSync(jsonOut, "utf8"));
    } catch {
      doc = null;
    }
    return { code: t.code, out: t.out, doc, jsonOut };
  };

  // AC 2 — A11-only board: green without the flag, red with it.
  const offA11 = audit(GH_DOWN);
  check(
    "A11-only board, no flag → exit 0 (exit behaviour unchanged), but the header counts `A11 … : 2` and names both cards",
    offA11.code === 0 && /A11 \(CI state unverifiable[^)]*\): 2 {2}· {2}cards: t_a11a0001, t_a11a0002/.test(offA11.out) && !/--fail-on-a11/.test(offA11.out),
    `exit=${offA11.code} out=${offA11.out.slice(0, 400)}`,
  );
  check(
    "A11-only board: an `ok` card carrying A11 is tagged on its own line (no bare `ok`)",
    ids.every((id) => new RegExp(`^ {2}ok {3}${id} .*\\[A11: CI state unverified`, "m").test(offA11.out)),
    offA11.out.slice(0, 600),
  );
  const onA11 = audit(GH_DOWN, ["--fail-on-a11"]);
  check(
    "A11-only board + --fail-on-a11 → exit 1, header says `--fail-on-a11: FAIL`, still 0 card violations (A11 is not a violation)",
    onA11.code === 1 && /--fail-on-a11: FAIL/.test(onA11.out) && onA11.doc && onA11.doc.counts.failures === 0 && onA11.doc.results.every((r) => r.violations.length === 0),
    `exit=${onA11.code} out=${onA11.out.slice(0, 300)}`,
  );

  // AC 1 — --json exposes counts.a11 and the list of ids.
  const js = runGate(["audit", "--db", miniDb, "--repo", repo, "--json"], "", { QA_GATE_GITHUB_FIXTURE: GH_DOWN });
  let jd = null;
  try {
    jd = JSON.parse(js.out);
  } catch {
    jd = null;
  }
  check(
    "--json: counts.a11 = 2, a11_task_ids = both ids, ok = true and fail_on_a11 = false without the flag",
    js.code === 0 && jd && jd.counts.a11 === 2 && JSON.stringify(jd.a11_task_ids) === JSON.stringify(ids) && jd.ok === true && jd.fail_on_a11 === false,
    `exit=${js.code} ${jd ? JSON.stringify({ counts: jd.counts, ids: jd.a11_task_ids, ok: jd.ok }) : js.out.slice(0, 200)}`,
  );
  check(
    "--json-out writes the same document as --json (counts + ids), and ok = false under --fail-on-a11",
    offA11.doc && jd && JSON.stringify(offA11.doc.counts) === JSON.stringify(jd.counts) && JSON.stringify(offA11.doc.a11_task_ids) === JSON.stringify(jd.a11_task_ids) && onA11.doc && onA11.doc.ok === false && onA11.doc.fail_on_a11 === true,
    JSON.stringify({ off: offA11.doc && offA11.doc.counts, on: onA11.doc && { ok: onA11.doc.ok, f: onA11.doc.fail_on_a11 } }),
  );

  // Non-vacuity — the SAME board with GitHub reachable: no A11, green both ways.
  const offClean = audit(GH_EMPTY);
  const onClean = audit(GH_EMPTY, ["--fail-on-a11"]);
  check(
    "board without A11 (same cards, GitHub reachable) → exit 0 without the flag, `A11 … : 0`",
    offClean.code === 0 && /A11 \(CI state unverifiable[^)]*\): 0\b/.test(offClean.out) && offClean.doc && offClean.doc.counts.a11 === 0 && offClean.doc.a11_task_ids.length === 0,
    `exit=${offClean.code} out=${offClean.out.slice(0, 300)}`,
  );
  check(
    "board without A11 + --fail-on-a11 → exit 0 (`--fail-on-a11: pass`), no card tagged A11",
    onClean.code === 0 && /--fail-on-a11: pass/.test(onClean.out) && !/\[A11:/.test(onClean.out),
    `exit=${onClean.code} out=${onClean.out.slice(0, 300)}`,
  );

  // The flag never masks or replaces a real violation: main fixture board.
  const mainOff = runGate(["audit", "--db", db, "--repo", repo, "--json"], "", { QA_GATE_GITHUB_FIXTURE: GH_PRS });
  let mainDoc = null;
  try {
    mainDoc = JSON.parse(mainOff.out);
  } catch {
    mainDoc = null;
  }
  check(
    "fixture board with violations and GitHub readable → still exit 1, counts.a11 = 0 (A11 counts only what GitHub could not answer)",
    mainOff.code === 1 && mainDoc && mainDoc.counts.a11 === 0 && mainDoc.counts.failures >= 10,
    `exit=${mainOff.code} counts=${mainDoc && JSON.stringify(mainDoc.counts)}`,
  );

  // The flags are audit-only; the per-card check and the hook never fail on A11.
  const chk = runGate(["check", "--task", ids[0], "--db", miniDb, "--repo", repo, "--fail-on-a11"], "", { QA_GATE_GITHUB_FIXTURE: GH_DOWN });
  check("check --fail-on-a11 → refused (exit 3): a per-card check never fails on A11", chk.code === 3 && /audit` only/.test(chk.out), `exit=${chk.code} out=${chk.out.slice(0, 200)}`);
  const hk = runGate(
    ["hook", "--db", miniDb],
    JSON.stringify({ hook_event_name: "pre_tool_call", tool_name: "kanban_complete", tool_input: { task_id: ids[0] }, cwd: repo, extra: {} }),
    { HERMES_KANBAN_DB: miniDb, QA_GATE_GITHUB_FIXTURE: GH_DOWN },
  );
  check("hook on an A11-only card → still allowed ({} + exit 0)", hk.code === 0 && hk.out.trim() === "{}", `exit=${hk.code} out=${hk.out.slice(0, 200)}`);

  // AC 3 — the workflow's summary/annotation step (scripts/qa/signoff-audit-summary.mjs).
  const summarize = (jsonPath) => {
    const sumFile = join(root, `summary-${cases}.md`);
    writeFileSync(sumFile, "");
    let code = 0;
    let out = "";
    try {
      out = execFileSync("node", [SUMMARY, "--json", jsonPath, "--summary-out", sumFile], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      code = e.status === undefined ? -1 : e.status;
      out = `${e.stdout || ""}${e.stderr || ""}`;
    }
    return { code, out, md: readFileSync(sumFile, "utf8") };
  };
  const s1 = summarize(onA11.jsonOut);
  const warnings = s1.out.split("\n").filter((l) => l.startsWith("::warning "));
  check(
    "summary: ONE `Bypasses and degradations` block — A11 row with counter 2, `yes — red (--fail-on-a11)`, both cards; then a per-card table with the A11 detail",
    s1.code === 0 &&
      (s1.md.match(/^### Bypasses and degradations$/gm) || []).length === 1 &&
      /^\| `A11_CI_STATE_UNVERIFIABLE` — CI state unverifiable — R9\/R10 not evaluated \| 2 \| \*\*yes — red\*\* \(`--fail-on-a11`\) \| `t_a11a0001`, `t_a11a0002` \|$/m.test(s1.md) &&
      /^#### `A11_CI_STATE_UNVERIFIABLE`: 2$/m.test(s1.md) &&
      ids.every((id) => new RegExp(`^\\| \`${id}\` \\| .* \\| .*GitHub.* \\|$`, "m").test(s1.md)),
    `exit=${s1.code} md=${s1.md.slice(0, 700)}`,
  );
  check(
    "annotations: exactly one ::warning:: per A11 card, each naming its card",
    warnings.length === 2 && ids.every((id, i) => warnings[i].includes(`A11 CI state unverifiable%3A ${id}`) && warnings[i].includes(`::${id} `)),
    s1.out.slice(0, 400),
  );
  check(
    "annotations: workflow-command escaping (`:` in the title property → %3A, `%` in the message → %25) — no raw delimiter can split the command",
    (warnings[0] || "").startsWith("::warning title=A11 CI state unverifiable%3A t_a11a0001::t_a11a0001 FE-970a A11-only: 100%25 compliant, title has") &&
      !/[\r\n]/.test(warnings[0] || ""),
    warnings[0] || "(none)",
  );
  const s1off = summarize(offA11.jsonOut);
  check(
    "summary without the flag: same A11 row, but `no (--fail-on-a11 off)` — the summary never claims a colour the exit code does not have",
    s1off.code === 0 && /^\| `A11_CI_STATE_UNVERIFIABLE` — .* \| 2 \| no \(`--fail-on-a11` off\) \| /m.test(s1off.md) && !/yes — red/.test(s1off.md),
    s1off.md.slice(0, 500),
  );
  const s2 = summarize(onClean.jsonOut);
  check(
    "summary on the board without A11: A11 row counter 0 (`no (--fail-on-a11 on, count 0)`), no per-card table, no annotation (non-vacuity)",
    s2.code === 0 && /^\| `A11_CI_STATE_UNVERIFIABLE` — .* \| 0 \| no \(`--fail-on-a11` on, count 0\) \| — \|$/m.test(s2.md) && !/^####/m.test(s2.md) && !/::warning/.test(s2.out),
    `exit=${s2.code} md=${s2.md.slice(0, 400)} out=${s2.out.slice(0, 200)}`,
  );
  const s3 = summarize(join(root, "no-such-audit.json"));
  check(
    "summary when the audit wrote no JSON → says `not available` + a warning, never a reassuring 0",
    s3.code === 0 && /^### Bypasses and degradations: not available$/m.test(s3.md) && !/\| 0 \|/.test(s3.md) && /::warning title=Bypasses and degradations not available::/.test(s3.out),
    `exit=${s3.code} md=${s3.md.slice(0, 200)}`,
  );
  const legacy = join(root, "audit-legacy.json");
  writeFileSync(legacy, JSON.stringify({ ok: true, counts: { failures: 0 }, results: [] }));
  const s4 = summarize(legacy);
  check(
    "summary on a document with no `degradations` block (older gate) → `not available`, never 0",
    s4.code === 0 && /: not available$/m.test(s4.md) && /no `degradations` block/.test(s4.md) && /::warning /.test(s4.out),
    s4.md.slice(0, 200),
  );

  // The block is generic (architect design note shared with t_5b5b61e2): the
  // text report and the JSON carry it as one block of typed entries.
  check(
    "text report: ONE `bypasses & degradations` block in the header, before the per-card lines",
    (offA11.out.match(/^ {2}bypasses & degradations /gm) || []).length === 1 && offA11.out.indexOf("bypasses & degradations") < offA11.out.indexOf("  ok   "),
    offA11.out.slice(0, 400),
  );
  const dA = onA11.doc && Array.isArray(onA11.doc.degradations) ? onA11.doc.degradations.find((d) => d.key === "a11") : null;
  check(
    "--json: `degradations[]` carries the A11 entry (rule, count, task_ids, fails_audit) consistent with counts.a11 / a11_task_ids, and per-card details",
    dA && dA.rule === "A11_CI_STATE_UNVERIFIABLE" && dA.count === 2 && dA.fails_audit === true && dA.fail_flag === "--fail-on-a11" &&
      JSON.stringify(dA.task_ids) === JSON.stringify(onA11.doc.a11_task_ids) && dA.cards.length === 2 && dA.cards.every((c) => /GitHub/.test(c.detail)),
    JSON.stringify(dA).slice(0, 400),
  );
  const dOff = offA11.doc && offA11.doc.degradations.find((d) => d.key === "a11");
  check("--json without the flag: A11 entry has fails_audit = false, fail_flag_on = false", dOff && dOff.count === 2 && dOff.fails_audit === false && dOff.fail_flag_on === false, JSON.stringify(dOff).slice(0, 300));

  // The switch takes no value: `--fail-on-a11 false` must not read as "on".
  const val = runGate(["audit", "--db", miniDb, "--repo", repo, "--fail-on-a11", "false"], "", { QA_GATE_GITHUB_FIXTURE: GH_DOWN });
  check("`--fail-on-a11 false` → refused (exit 3), never silently on", val.code === 3 && /takes no value/.test(val.out), `exit=${val.code} out=${val.out.slice(0, 200)}`);
  const jn = runGate(["audit", "--db", miniDb, "--repo", repo, "--json-out"], "", { QA_GATE_GITHUB_FIXTURE: GH_DOWN });
  check("`--json-out` without a path → refused (exit 3)", jn.code === 3 && /requires a file path/.test(jn.out), `exit=${jn.code} out=${jn.out.slice(0, 200)}`);
}

console.log("\n10. The audit lists every bypass — X1 exception, X2 withdrawn, X3 completed outside the hook — and never fails on one (t_5b5b61e2, §5.10):");
{
  const SUMMARY = join(HERE, "signoff-audit-summary.mjs");
  const DAY = 86400;
  const NOW_ISO = new Date((EPOCH_AFTER + 10 * DAY) * 1000).toISOString();
  const verdict = qaVerdict("QA-VERDICT: pass — evidence: tests/evidence/__ID__/README.md");
  // A secret-SHAPED value built at runtime, so no line of this file carries a
  // keyword next to a quoted value (gitleaks generic-api-key, see the skill
  // pitfall): `tok` + `en=` + 24 chars matches secret-guard R_SECRET_KEY_VALUE_PAIR.
  const FAKE_SECRET_VALUE = "Zq7".repeat(8);
  const FAKE_SECRET = ["tok", "en=", FAKE_SECRET_VALUE].join("");
  const MD_REASON = "see ![pixel](https://example.invalid/p.png) and [link](https://example.invalid) | col `code` *em*";
  const exc = (reason) => `qa-signoff-exception: ${reason}`;
  const B = (n) => `t_b5b6${n.toString(16).padStart(4, "0")}`;
  const bp = [
    // X1 — in force (architect) + a redundant later record (human).
    { tid: B(1), title: "BP-01 exception in force + a redundant one", comments: [{ author: "architect", body: exc("incident INC-7, verdict waived 24h") }, { author: "human", body: exc("same incident, confirmed by the human") }] },
    { tid: B(2), title: "BP-02 exception recorded from the dashboard", comments: [{ author: "dashboard", body: exc("closed by human decision, duplicate card") }] },
    // Author model of t_b8001b55: none of these is an exception — never listed under X1.
    { tid: B(3), title: "BP-03 quoted key only (A10)", comments: [{ author: "architect", body: "The key is `qa-signoff-exception: <reason>` — not used here." }, verdict] },
    { tid: B(4), title: "BP-04 exception by an executing profile (A10)", comments: [{ author: "backend", body: exc("I waive my own card") }, verdict] },
    {
      tid: B(5),
      title: "BP-05 crypto card: exception refused (security track)",
      body: "**Test Types:** unit, security\nImplements the packages/crypto AEAD wrapper.",
      comments: [{ author: "architect", body: exc("waive AR-6 please") }, { author: "architect", body: "Architect sign-off: approved (AR-6)." }, verdict],
    },
    // X2 — withdrawn (history), and withdrawn then re-armed (X1 + X2).
    { tid: B(6), title: "BP-06 exception withdrawn", comments: [{ author: "architect", body: exc("temporary waiver") }, { author: "qa", body: "qa-signoff-exception withdrawn: the incident is closed" }, verdict] },
    {
      tid: B(7),
      title: "BP-07 exception withdrawn then re-armed",
      comments: [{ author: "architect", body: exc("first waiver") }, { author: "qa", body: "qa-signoff-exception withdrawn: not justified" }, { author: "human", body: exc("re-approved after review") }],
    },
    // AR-2 + untrusted text.
    { tid: B(8), title: "BP-08 exception whose reason carries a secret shape", comments: [{ author: "architect", body: exc(`pasted by mistake ${FAKE_SECRET}`) }] },
    { tid: B(9), title: "BP-09 exception whose reason carries Markdown | pipes", comments: [{ author: "architect", body: exc(MD_REASON) }] },
    // X3 — completions without the hook, and a worker completion (control).
    { tid: B(10), title: "BP-10 completed from the CLI (synthesized run)", comments: [verdict] },
    { tid: B(11), title: "BP-11 completed by direct board edit (no run)", comments: [verdict] },
    { tid: B(12), title: "BP-12 manual_complete events (one old, one recent)", comments: [verdict] },
    { tid: B(13), title: "BP-13 worker completion through the hook (control)", comments: [verdict] },
  ].map((c) => ({ body: "**Test Types:** unit", assignee: "frontend", status: "done", completed: EPOCH_AFTER, runs: [], attachments: [], ...c }));
  for (const c of bp) fixtureFile(`tests/evidence/${c.tid}/README.md`);
  const ev = (id, tid, runId, kind, payload, at) =>
    `INSERT INTO task_events (id,task_id,run_id,kind,payload,created_at) VALUES (${id},'${tid}',${runId === null ? "NULL" : runId},'${kind}','${JSON.stringify(payload).replace(/'/g, "''")}',${at});`;
  const run = (id, tid, profile, status, at0, at1) =>
    `INSERT INTO task_runs (id,task_id,profile,status,outcome,summary,metadata,started_at,ended_at) VALUES (${id},'${tid}','${profile}','${status}','completed','handoff','{}',${at0},${at1});`;
  const extraSql = [
    // Hermes `_synthesize_ended_run`: status = outcome = 'completed', zero duration.
    run(9001, B(10), "frontend", "completed", EPOCH_AFTER + 50, EPOCH_AFTER + 50),
    ev(1, B(10), 9001, "completed", { summary: "approved from the terminal\nsecond line" }, EPOCH_AFTER + 50),
    ev(2, B(11), null, "completed", { summary: "closed by a human edit", closure_method: "human_direct_db_edit" }, EPOCH_AFTER + 60),
    ev(3, B(12), null, "manual_complete", { reason: "old closure, before the window" }, EPOCH_AFTER - 40 * DAY),
    ev(4, B(12), null, "manual_complete", { reason: "closed as duplicate via direct SQL" }, EPOCH_AFTER + 70),
    // A worker run ends with status 'done' (`_end_run`): NOT a bypass.
    run(9002, B(13), "frontend", "done", EPOCH_AFTER + 10, EPOCH_AFTER + 80),
    ev(5, B(13), 9002, "completed", { summary: "worker handoff" }, EPOCH_AFTER + 80),
  ];
  const bpDb = join(root, "board-bypass.db");
  execFileSync("sqlite3", [bpDb], { input: [BOARD_SQL, ...bp.map(taskRowSQL), ...extraSql].join("\n") });
  // Same cards on a legacy board WITHOUT task_events.
  const legacyDb = join(root, "board-bypass-legacy.db");
  execFileSync("sqlite3", [legacyDb], { input: [BOARD_SQL.replace(EVENTS_SQL, ""), ...bp.map(taskRowSQL)].join("\n") });

  const audit = (dbPath, extra = []) => {
    const jsonOut = join(root, `bp-audit-${cases}.json`);
    const t = runGate(["audit", "--db", dbPath, "--repo", repo, "--json-out", jsonOut, "--now-iso", NOW_ISO, ...extra]);
    let doc = null;
    try {
      doc = JSON.parse(readFileSync(jsonOut, "utf8"));
    } catch {
      doc = null;
    }
    return { code: t.code, out: t.out, doc, jsonOut };
  };
  const summarize = (jsonPath) => {
    const sumFile = join(root, `bp-summary-${cases}.md`);
    writeFileSync(sumFile, "");
    let code = 0;
    let out = "";
    try {
      out = execFileSync("node", [SUMMARY, "--json", jsonPath, "--summary-out", sumFile], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      code = e.status === undefined ? -1 : e.status;
      out = `${e.stdout || ""}${e.stderr || ""}`;
    }
    return { code, out, md: readFileSync(sumFile, "utf8") };
  };
  const deg = (doc, key) => (doc && Array.isArray(doc.degradations) ? doc.degradations.find((d) => d.key === key) : null);

  const a = audit(bpDb, ["--fail-on-a11"]);
  const x1 = deg(a.doc, "x1");
  const x2 = deg(a.doc, "x2");
  const x3 = deg(a.doc, "x3");

  // Criterion 3 — never fails on a bypass.
  check(
    "board whose only findings are bypasses → audit exit 0, ok = true, 0 violations, even with --fail-on-a11 (a bypass never turns the audit red)",
    a.code === 0 && a.doc && a.doc.ok === true && a.doc.counts.failures === 0 && [x1, x2, x3].every((d) => d && d.fails_audit === false && d.fail_flag === null),
    `exit=${a.code} counts=${a.doc && JSON.stringify(a.doc.counts)} out=${a.out.slice(0, 300)}`,
  );

  // Criterion 1 — every X1, with card, author, reason, date, under the corrected author model.
  const x1Ids = x1 ? x1.task_ids.slice().sort() : [];
  check(
    "X1: exactly the exceptions in force — BP-01, 02, 07 (re-armed), 08, 09; never the quoted key, the executing profile, the security-track card or the withdrawn one",
    JSON.stringify(x1Ids) === JSON.stringify([B(1), B(2), B(7), B(8), B(9)]) && x1.count === 5,
    JSON.stringify(x1Ids),
  );
  const r1 = x1 ? (x1.cards.find((c) => c.task_id === B(1)) || {}).records || [] : [];
  check(
    "X1: every occurrence is a record — BP-01 lists the exception in force (architect) AND the redundant one (human), each with its reason and its comment date; occurrences = 6",
    x1 && x1.occurrences === 6 && r1.length === 2 &&
      r1[0].author === "architect" && r1[0].state === "in force" && r1[0].reason === "incident INC-7, verdict waived 24h" && r1[0].at === EPOCH_AFTER &&
      r1[1].author === "human" && /^redundant/.test(r1[1].state) && r1[1].at === EPOCH_AFTER + 1,
    JSON.stringify(r1),
  );
  check(
    "--json: counts.exceptions = { available, cards 5, occurrences 6 }; counts.completed_outside_hook = { available, cards 3, occurrences 4 }",
    a.doc && JSON.stringify(a.doc.counts.exceptions) === JSON.stringify({ available: true, cards: 5, occurrences: 6 }) &&
      JSON.stringify(a.doc.counts.completed_outside_hook) === JSON.stringify({ available: true, cards: 3, occurrences: 4 }) &&
      JSON.stringify(a.doc.counts.exceptions_withdrawn) === JSON.stringify({ available: true, cards: 2, occurrences: 2 }),
    a.doc && JSON.stringify(a.doc.counts),
  );
  // X2 is history, consistent with t_b2588ee7: listed, but not an active bypass.
  const x2Ids = x2 ? x2.task_ids.slice().sort() : [];
  const r6 = x2 ? (x2.cards.find((c) => c.task_id === B(6)) || {}).records || [] : [];
  check(
    "X2: the withdrawn exceptions (BP-06, BP-07) are history — who recorded it, who withdrew it, why — and BP-06 is NOT under X1",
    JSON.stringify(x2Ids) === JSON.stringify([B(6), B(7)]) && r6.length === 1 && r6[0].author === "architect" && /^withdrawn by qa on .*: the incident is closed$/.test(r6[0].state) && !x1Ids.includes(B(6)),
    JSON.stringify(x2 && x2.cards),
  );

  // Criterion 2 — CLI / out-of-band completions, in the SAME block.
  const x3Ids = x3 ? x3.task_ids.slice().sort() : [];
  const rec = (tid) => (x3 ? (x3.cards.find((c) => c.task_id === tid) || {}).records || [] : []);
  check(
    "X3: synthesized-run completion (CLI), no-run completion and manual_complete events are listed; the worker completion through the hook is NOT",
    JSON.stringify(x3Ids) === JSON.stringify([B(10), B(11), B(12)]) && !x3Ids.includes(B(13)),
    JSON.stringify(x3Ids),
  );
  const r10 = rec(B(10));
  const r11 = rec(B(11));
  const r12 = rec(B(12));
  check(
    "X3 records: method, date, reason (summary / closure_method / manual_complete reason), actor `not recorded` (Hermes does not record who ran the CLI), newline flattened",
    r10.length === 1 && /outside a worker run \(CLI \/ dashboard\)/.test(r10[0].state) && r10[0].author === "not recorded" && r10[0].reason === "approved from the terminal second line" && r10[0].at === EPOCH_AFTER + 50 &&
      r11.length === 1 && /human_direct_db_edit/.test(r11[0].state) &&
      r12.length === 2 && r12.every((x) => /manual_complete/.test(x.state)) && r12[1].reason === "closed as duplicate via direct SQL",
    JSON.stringify({ r10, r11, r12 }),
  );
  const chkBp10 = runGate(["check", "--task", B(10), "--db", bpDb, "--repo", repo, "--json"]);
  let p10 = null;
  try {
    p10 = JSON.parse(chkBp10.out);
  } catch {
    p10 = null;
  }
  const chkBp13 = runGate(["check", "--task", B(13), "--db", bpDb, "--repo", repo, "--json"]);
  check(
    "check --task: the CLI-completed card carries the X3_COMPLETED_OUTSIDE_HOOK advisory and no violation; the worker-completed control does not",
    chkBp10.code === 0 && p10 && p10.advisories.some((x) => x.rule === "X3_COMPLETED_OUTSIDE_HOOK") && p10.violations.length === 0 &&
      chkBp13.code === 0 && !/X3_COMPLETED_OUTSIDE_HOOK/.test(chkBp13.out),
    `bp10 exit=${chkBp10.code} bp13=${chkBp13.out.slice(0, 200)}`,
  );

  // Text report — readable without the board, one line per occurrence.
  check(
    "text report: X1/X2/X3 lines inside the ONE bypasses block, with counts, occurrences and a line per occurrence (card, date, author, reason, state)",
    (a.out.match(/^ {2}bypasses & degradations /gm) || []).length === 1 &&
      /^ {4}X1 \(QA sign-off exception in force[^)]*\)[^:]*: 5 {2}· {2}occurrences: 6 {2}· {2}cards: /m.test(a.out) &&
      /^ {4}X3 \(completed outside the completion hook[^\n]*: 3 {2}· {2}occurrences: 4 /m.test(a.out) &&
      new RegExp(`^ {8}${B(1)} {2}\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC {2}architect {2}incident INC-7, verdict waived 24h {2}\\[in force\\]$`, "m").test(a.out) &&
      new RegExp(`^ {8}${B(12)} {2}.* {2}not recorded {2}closed as duplicate via direct SQL {2}\\[manual_complete`, "m").test(a.out),
    a.out.slice(0, 1500),
  );

  // Criterion 3 — trend and threshold named in the output.
  check(
    "trend: X1 last 30 days 6 > watch threshold 2 → `ABOVE`; X3 last 30 days 3, previous 30 days 1 (the old manual_complete), by month 2026-08: 1, 2026-09: 3; below its threshold",
    x1 && x1.trend.last_30d === 6 && x1.trend.above_watch === true && x1.trend.watch_threshold_30d === 2 &&
      x3 && x3.trend.last_30d === 3 && x3.trend.previous_30d === 1 && x3.trend.above_watch === false && JSON.stringify(x3.trend.by_month) === JSON.stringify({ "2026-08": 1, "2026-09": 3 }) &&
      /trend: last 30 days 6 \(previous 30 days 0, rising\) {2}· {2}watch threshold 2\/30d: ABOVE/.test(a.out),
    JSON.stringify({ x1: x1 && x1.trend, x3: x3 && x3.trend }),
  );

  // AR-2 — no secret value anywhere in the output.
  const s = summarize(a.jsonOut);
  const everywhere = [a.out, readFileSync(a.jsonOut, "utf8"), s.md, s.out].join("\n");
  check(
    "AR-2: a secret-shaped reason is withheld (rule id only) — the value appears in NONE of: text report, JSON document, run summary, annotations",
    !everywhere.includes(FAKE_SECRET_VALUE) && /\[reason withheld: matches R_SECRET_KEY_VALUE_PAIR/.test(a.out) && /reason withheld: matches R\\_SECRET\\_KEY\\_VALUE\\_PAIR/.test(s.md),
    `leak=${everywhere.includes(FAKE_SECRET_VALUE)} md=${s.md.slice(0, 200)}`,
  );

  // Workflow summary: one place for both forms of bypass.
  check(
    "summary: X1, X2 and X3 rows in the SAME `Bypasses and degradations` table (cards + occurrences, `never`), plus a trend table naming the watch threshold",
    s.code === 0 && (s.md.match(/^### Bypasses and degradations$/gm) || []).length === 1 &&
      /^\| `X1_EXCEPTION` — .* \| 5 \(6 occurrences\) \| never \| /m.test(s.md) &&
      /^\| `X2_EXCEPTION_WITHDRAWN` — .* \| 2 \(2 occurrences\) \| never \| /m.test(s.md) &&
      /^\| `X3_COMPLETED_OUTSIDE_HOOK` — .* \| 3 \(4 occurrences\) \| never \| /m.test(s.md) &&
      /^\| `X1_EXCEPTION` \| 6 \| 0 \| rising \| 2: \*\*above — review\*\* \| 2026-09: 6 \|$/m.test(s.md),
    s.md.slice(0, 1600),
  );
  check(
    "summary: one row per occurrence (date, card, title, author, reason, state) — `#### X1_EXCEPTION: 6 occurrences on 5 cards` and `#### X3_COMPLETED_OUTSIDE_HOOK: 4 occurrences on 3 cards`",
    /^#### `X1_EXCEPTION`: 6 occurrences on 5 cards$/m.test(s.md) &&
      /^#### `X3_COMPLETED_OUTSIDE_HOOK`: 4 occurrences on 3 cards$/m.test(s.md) &&
      new RegExp(`^\\| \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC \\| \`${B(1)}\` \\| BP-01 .* \\| architect \\| incident INC-7, verdict waived 24h \\| in force \\|$`, "m").test(s.md),
    s.md.slice(0, 2000),
  );
  check(
    "summary: untrusted Markdown in a reason is escaped — no live image/link, the pipe cannot split the row",
    !s.md.includes("![pixel](") && !s.md.includes("[link](") && s.md.includes("\\!\\[pixel\\]\\(https://example.invalid/p.png\\)") &&
      new RegExp(`^\\| [^\\n]* \\| \`${B(9)}\` \\| [^\\n]*\\\\\\| col \\\\\`code\\\\\` \\\\\\*em\\\\\\* \\| in force \\|$`, "m").test(s.md),
    (s.md.split("\n").find((l) => l.includes(B(9)) && l.startsWith("| 2")) || "(no row)").slice(0, 300),
  );
  const warn = s.out.split("\n").filter((l) => l.startsWith("::warning "));
  const notice = s.out.split("\n").filter((l) => l.startsWith("::notice "));
  check(
    "annotations: one ::warning:: per X1 exception (6) + one for X1 above its watch threshold; one ::notice:: per non-empty X2/X3 type (never one per CLI completion)",
    warn.filter((l) => l.startsWith("::warning title=X1 sign-off exception%3A t_")).length === 6 &&
      warn.filter((l) => /above watch threshold/.test(l)).length === 1 &&
      notice.length === 2 && notice.some((l) => l.startsWith("::notice title=X3 completed outside the hook%3A 4::")),
    s.out.slice(0, 600),
  );

  // A board without `task_events`: X3 is "not available", never 0; the hook still works.
  const l = audit(legacyDb);
  const lx3 = deg(l.doc, "x3");
  const ls = summarize(l.jsonOut);
  check(
    "legacy board without task_events → X3 `not available` (text, JSON, summary + warning), never a reassuring 0; X1 still listed; exit unchanged (0)",
    l.code === 0 && lx3 && lx3.available === false && l.doc?.counts?.completed_outside_hook?.available === false && l.doc?.counts?.completed_outside_hook?.occurrences === null &&
      /^ {4}X3 \([^\n]*: not available — /m.test(l.out) && deg(l.doc, "x1")?.count === 5 &&
      /^\| `X3_COMPLETED_OUTSIDE_HOOK` — .* \| \*\*not available\*\* \| never \| /m.test(ls.md) && /::warning title=X3 completed outside the hook%3A not available::/.test(ls.out),
    `exit=${l.code} x3=${String(JSON.stringify(lx3 ?? null)).slice(0, 200)} out=${l.out.slice(0, 400)}`,
  );
  const hk = runGate(
    ["hook", "--db", legacyDb],
    JSON.stringify({ hook_event_name: "pre_tool_call", tool_name: "kanban_complete", tool_input: { task_id: B(13) }, cwd: repo, extra: {} }),
    { HERMES_KANBAN_DB: legacyDb },
  );
  check("hook on a board without task_events → a compliant card is still allowed ({} + exit 0): the events read never fails the fail-closed hook", hk.code === 0 && hk.out.trim() === "{}", `exit=${hk.code} out=${hk.out.slice(0, 200)}`);

  // AR-2 fail-safe: without the scanner next to the gate, no reason is printed.
  const lone = join(root, "gate-without-secret-guard");
  mkdirSync(lone, { recursive: true });
  writeFileSync(join(lone, "signoff-gate.mjs"), readFileSync(GATE));
  let loneOut = "";
  let loneCode = 0;
  try {
    loneOut = execFileSync("node", [join(lone, "signoff-gate.mjs"), "audit", "--db", bpDb, "--repo", repo, "--now-iso", NOW_ISO], {
      encoding: "utf8",
      env: { ...process.env, HERMES_KANBAN_TASK: "", HERMES_KANBAN_WORKSPACE: "", HERMES_KANBAN_BRANCH: "", QA_GATE_GITHUB: "", QA_GATE_GH_REPO: "", QA_GATE_GITHUB_FIXTURE: GH_EMPTY },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    loneCode = e.status;
    loneOut = `${e.stdout || ""}${e.stderr || ""}`;
  }
  check(
    "fail-safe: a gate copy with no secret-guard.mjs next to it withholds every reason (`secret scanner … unavailable`) instead of printing it unscanned; exit unchanged",
    loneCode === 0 && /\[reason withheld: secret scanner \(secret-guard\.mjs\) unavailable\]/.test(loneOut) && !loneOut.includes("incident INC-7") && !loneOut.includes(FAKE_SECRET_VALUE),
    `exit=${loneCode} out=${loneOut.slice(0, 300)}`,
  );

  // --now-iso is audit-only and validated.
  const nc = runGate(["check", "--task", B(1), "--db", bpDb, "--repo", repo, "--now-iso", NOW_ISO]);
  const nb = runGate(["audit", "--db", bpDb, "--repo", repo, "--now-iso", "yesterday"]);
  check("`check --now-iso` → refused (exit 3); `audit --now-iso yesterday` → refused (exit 3)", nc.code === 3 && nb.code === 3 && /ISO-8601/.test(nb.out), `check=${nc.code} audit=${nb.code} ${nb.out.slice(0, 120)}`);
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
