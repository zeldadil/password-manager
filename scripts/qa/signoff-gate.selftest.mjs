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

console.log(`\n${cases - failures.length}/${cases} cases passed`);
if (failures.length) {
  console.log("\nFAILED CASES:");
  for (const f of failures) console.log(`  - ${f}`);
  if (!KEEP) rmSync(root, { recursive: true, force: true });
  process.exit(1);
}
if (!KEEP) rmSync(root, { recursive: true, force: true });
process.exit(0);
