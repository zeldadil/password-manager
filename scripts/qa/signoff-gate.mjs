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
 *                                           [--strict-history] [--json] [--json-out FILE]
 *                                           [--fail-on-a11] [--now-iso ISO]
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
 *     this card's missing evidence (t_99e408c5; QA_SIGN_OFF_GATE.md §5.7);
 *   - a *comment* records a verdict only when a QA profile wrote it (QA_SIGN_OFF_GATE.md
 *     §3 author rule, t_338f47fd): the marker path used to accept any author, so one
 *     `QA-VERDICT: pass — evidence: …` comment from `architect`/`frontend`/`dashboard`
 *     cleared R1/R2/R3 through the fail-closed completion hook. A discounted marker is
 *     reported as `A7_VERDICT_AUTHOR_IGNORED`; a run-metadata verdict stays
 *     author-independent by design (§3 row 3) and is reported as
 *     `A8_VERDICT_SELF_DECLARED` when a non-QA run self-declares it;
 *   - a `qa-signoff-exception:` is applied only when an allowed author wrote it
 *     (human/dashboard/user/architect/qa — never `worker`), outside code spans,
 *     on a non-security-track card (t_b8001b55; QA_SIGN_OFF_GATE.md §5.6). Any
 *     other exception record is reported as `A10_EXCEPTION_IGNORED` and waives
 *     nothing; R7 never consults the exception;
 *   - an exception can be withdrawn by a later `qa-signoff-exception withdrawn:
 *     <reason>` record under the same author/code-span rules (t_b2588ee7;
 *     QA_SIGN_OFF_GATE.md §5.6). A withdrawn exception is reported as
 *     `X2_EXCEPTION_WITHDRAWN`; a refused or no-op withdrawal as
 *     `A16_EXCEPTION_WITHDRAWAL_IGNORED`.
 *
 * R9/R10 (t_75180b28, QA_SIGN_OFF_GATE.md §5.9): a **code** card — one a PR
 * declares, one with a pushed branch named after it, or one whose body says
 * `Deliverable: code` — completes only when a linked PR is merged into the
 * default branch (R9_PR_NOT_MERGED) and every required check of that branch's
 * protection is green on the merge commit (R10_MERGE_CI_NOT_GREEN). Both facts
 * are read from GitHub through `gh` at check time, never from the card. When
 * GitHub cannot be read the result is the advisory A11_CI_STATE_UNVERIFIABLE,
 * never a violation. Extra audit/check flags: --gh-repo OWNER/NAME,
 * --no-github, --pr-epoch-iso ISO.
 *
 * R7 scope-v2 (t_90a4bd73, decision t_18230e85 option C): security-track is
 * classified on the crypto/bridge boundary named in the card (SCOPE_V2_TOKENS),
 * no longer on a `security` Test Type. A card completed before R7_V2_EPOCH_ISO
 * keeps its v1 obligation. A card that only v2 classifies gets the advisory
 * A17_R7_SCOPE_V2_UNGATED. Extra audit/check flag: --r7-v2-epoch-iso ISO.
 *
 * A PR is *linked* to a card only by declaration (t_7e8bf917): its head branch
 * is named after the card, or its body has a `Closes <id>` / `Card: <id>` /
 * `Task: <id>` line outside code. A mere mention (title, prose, quote, code
 * span/fence) is the advisory A14_PR_MENTIONS_CARD — never a link, so it can
 * neither trigger nor satisfy R9.
 *
 * R10 judges the run the merge triggered (t_339a0d02): the `push` run on the
 * merge commit, its newest attempt included. A run on the same SHA from another
 * event (workflow_dispatch, schedule, …) is never judged; when it disagrees it
 * is the advisory A15_NON_PUSH_RUN_ON_MERGE_COMMIT. A required check carried
 * only by non-push runs is `no-push-run` → R10 (fail closed).
 *
 * A11 is counted and surfaced by `audit` (t_b102b100, QA_SIGN_OFF_GATE.md §5.9):
 * the report header carries an A11 counter and the list of cards, an `ok` card
 * that carries one is tagged, and `--json` exposes `counts.a11` and
 * `a11_task_ids`. A11 stays an advisory per card (a GitHub outage must never
 * make a card uncompletable); the *audit* turns red on it only with
 * `--fail-on-a11` (exit 1), which the scheduled workflow passes — an audit that
 * runs with GitHub and still gets A11 is a real degradation (token, branch
 * protection, time budget). Without the flag the exit code is unchanged.
 * `--json-out FILE` writes the `--json` document to FILE as well, so one
 * evaluation yields both the text report and the machine-readable one.
 *
 * Bypasses are listed by `audit` too (t_5b5b61e2, QA_SIGN_OFF_GATE.md §5.10), in
 * the same "bypasses & degradations" block, one line per OCCURRENCE (card, date,
 * author, reason, state) so the report reads without opening the board:
 * X1_EXCEPTION (an exception in force, plus the redundant records repeating
 * it), X2_EXCEPTION_WITHDRAWN (history, not an active bypass) and
 * X3_COMPLETED_OUTSIDE_HOOK (a completion the `pre_tool_call` hook never saw:
 * CLI, dashboard, direct board edit — read from the board's `task_events`).
 * Each bypass type carries a per-month trend and a 30-day watch threshold
 * (`BYPASS_WATCH_30D`; `--now-iso` anchors the window). A bypass NEVER changes
 * the exit code. Reasons are free text: they pass through the repo's secret
 * scanner (secret-guard.mjs) and are withheld, rule ids only, on a hit (AR-2).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * The repo's secret scanner (scripts/qa/secret-guard.mjs, SEC-001), used to keep
 * secret-shaped values out of the bypass report (t_5b5b61e2, AR-2): exception
 * and override reasons are free text written by agents and humans. Loaded from
 * the sibling file (it ships next to this script in the repo and in every
 * profile's agent-hooks/); when it cannot be loaded, reasons are withheld —
 * never printed unscanned.
 */
let secretScanText = null;
try {
  ({ scanText: secretScanText } = await import(new URL("./secret-guard.mjs", import.meta.url).href));
} catch {
  secretScanText = null;
}

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

/**
 * Authors allowed to record a §5.6 `qa-signoff-exception:` (t_b8001b55). Until
 * this fix `findException` read `c.author` only to *display* it, so any profile
 * could waive R1/R4/R7 with one comment — the same omission t_338f47fd closed on
 * the verdict marker. Humans (`human`, `dashboard`, `user`), `architect` and
 * `qa` only. `worker` is deliberately absent: it names no profile, so it cannot
 * be held to an approval (refused with its own advisory wording).
 */
const EXCEPTION_AUTHORS = new Set(["human", "dashboard", "user", "architect", "qa"]);

const VERDICT_MARKER_RE = /(?:^|[\s(])qa[\s_-]*verdict\s*:\s*([a-z][a-z-]*)/i;
// Loose path — colon-only, mirroring the marker above (t_df8e644a, the residual
// half of t_c3cb6842). While the separator also accepted `-` and `—`, a `qa`
// comment that merely *cited* an evidence file name produced a verdict token:
// `tests/evidence/t_0af5aa3e/QA-VERDICT-ROTATION.md` matched as "VERDICT-ROTATION"
// → token "rotation" → R2_QA_VERDICT_INVALID on the citing card (reproduced on
// the live board, qa comment 49 on t_80fc0326; the gate must never read a *path it
// is shown* as a verdict token). A colon is what §5.1 records (`QA-VERDICT: <token>`);
// a file name never carries one.
//
// The marker's leading boundary is deliberately NOT mirrored here: this path is the
// fallback that still reads `**QA-VERDICT: pass**`, which the marker rejects because
// the `*` of the bold markup precedes `qa` (live record: t_f49d448c).
const VERDICT_LOOSE_RE = /verdict\s*:\s*([a-z][a-z-]*)/i;
// Same leading boundary as VERDICT_MARKER_RE (t_c3cb6842): a marker that only
// appears inside a code span — a handoff quoting the recording command, a
// troubleshooting transcript — is documentation, not a live deferral
// (t_58280940: frontend's gate-defect report quoted the marker and the gate
// then judged *that* quote as the card's live deferral target).
const DEFERRAL_RE = /(?:^|[\s(])qa[\s_-]*verdict\s*[:\-—]+\s*deferred/i;
// The negative lookahead keeps the withdrawal key below (t_b2588ee7) from being
// read as an exception: `qa-signoff-exception-withdrawn: …` and
// `qa-signoff-exception: withdrawn — …` would otherwise both match here, the
// first with the reason "withdrawn: …" — a withdrawal turned into a waiver.
const EXCEPTION_RE = /qa[\s_-]*signoff[\s_-]*exception(?![\s_:\-—]*withdrawn\b)\s*[:\-—]+\s*(\S[^\n]*)/i;
// Global twin for scanning every occurrence in a comment (t_b8001b55): a body
// can quote the key in a code span *and* record a real one further down.
const EXCEPTION_RE_G = new RegExp(EXCEPTION_RE.source, "gi");
/**
 * §5.6 withdrawal key (t_b2588ee7): `qa-signoff-exception withdrawn: <reason>`
 * (any of the separators the exception key accepts; the reason is optional so
 * that a bare "QA signoff exception withdrawn" is never a silent no-op). See
 * `findException` for why an explicit key was chosen over "last one wins".
 */
const WITHDRAWAL_RE_G = /qa[\s_-]*signoff[\s_-]*exception[\s_:\-—]*withdrawn\b[ \t]*[:\-—]*[ \t]*([^\n]*)/gi;
const ARCH_SIGNOFF_RE = /(arch[\s_-]*(verdict|sign[\s_-]*off)|approv|signed[\s_-]*off|LGTM)/i;
const TASK_ID_RE = /\bt_[0-9a-f]{8}\b/g;
const TEST_TYPES_RE = /test\s*types\s*:?\**\s*([^\n]+)/i;
/**
 * R7 security-track classification, **scope-v2** (t_90a4bd73). Decision:
 * docs/decisions/ARCH-DECISION-t_18230e85.md, option C, dual architect + qa
 * sign-off. The boundary list comes from the ADRs (decision record §3,
 * docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md §4.1). A card is
 * security-track when its title or body names an artifact inside the crypto or
 * bridge boundary. The self-declared Test Type is no longer read: v1 also
 * required `security` there, and that AND hid 13 in-scope cards (e.g. a
 * "KDF + Vault Key Storage" card that declares `Test Types: unit`).
 *
 * Tokens have **no trailing `\b`**. v1 wrapped the whole list in `\b(...)\b`,
 * so `autofill` could not match the contract's own `AUTOFILL_REQUEST` (`_` is a
 * word character), `bridge-message` could not match `bridge messages` or
 * `BRIDGE_MESSAGE`, and `crypto boundary` could not match `crypto boundaries`.
 * Separators accept space, `-` and `_`. `/i` is kept, so
 * `vault[\s_-]*key` already matched `vaultKey` under v1 (t_9ae2bc23 finding);
 * that is not one of the fixes.
 */
export const SCOPE_V2_TOKENS = Object.freeze([
  // ADR-002 §5.2 — the crypto package and its module boundary
  String.raw`packages/crypto`,
  String.raw`crypto[\s_-]*(?:primitive|implementation|boundar(?:y|ies)|module|package)`, // "crypto boundaries" (ADR-002 card t_3ca45da2)
  // ADR-002 §5.1, §5.3 — KDF / AEAD primitives, nonce/IV, tag verification
  String.raw`KDF`,
  String.raw`AEAD`,
  String.raw`Argon2id`,
  String.raw`AES[\s_-]*256[\s_-]*GCM`,
  String.raw`GCM[\s_-]*tag`,
  String.raw`(?<![\p{L}\p{N}])nonce`, // not inside a word: French "annonce" / "Énoncer" contain "nonce"
  String.raw`\bIVs?\b`,
  // ADR-002 §5.1, §5.3, §5.5 — keys, wrapping, recovery, encrypted export
  String.raw`key[\s_-]*wrap`,
  String.raw`vault[\s_-]*key(?!board)`,
  String.raw`master[\s_-]*key(?!board)`,
  String.raw`\bsub[\s_-]*key(?!board)`,
  String.raw`recovery[\s_-]*(?:kit|key)`,
  String.raw`encrypt(?:ed)?[\s_-]*(?:backup|export)`,
  String.raw`backup[\s_-]*(?:export|dump)`,
  // ADR-002 §5.3 Decision 6 — lock/unlock lifecycle
  String.raw`lock[/-]unlock`,
  // ADR-002 §5.4 — RNG and the platform crypto APIs
  String.raw`randomBytes`,
  String.raw`getRandomValues`,
  String.raw`node:crypto`,
  String.raw`crypto\.subtle`,
  // ADR-005 §2.1, §5, §9.2 — bridge message contract (packages/shared)
  String.raw`packages/shared`,
  String.raw`bridge[\s_-]*(?:protocol|message)`,
  String.raw`autofill`, // also AUTOFILL_REQUEST / AUTOFILL_RESPONSE
  String.raw`LOCK_STATE_CHANGED`,
  String.raw`VAULT_SEARCH`,
  String.raw`vault[\s_-]*session[\s_-]*sync`,
  // ADR-005 §3, §9.3 — origin validation (bridge scope confirmed by t_18230e85 §2)
  String.raw`origin[\s_-]*validation`,
  String.raw`allowed[\s_-]*origin`,
  String.raw`sender\.origin`,
  String.raw`postMessage`,
]);
export const SECURITY_TRACK_RE = new RegExp(`(?:${SCOPE_V2_TOKENS.join("|")})`, "iu");

/**
 * scope-v2 ∧ ¬qa. Option C dropped the `security` Test-Type condition. The
 * `qa`-assignee exemption stays: QA cannot be the Architect half of AR-6 on its
 * own work, and QA's gate cards quote these tokens as subject matter.
 */
export function isSecurityTrack(task) {
  return (
    SECURITY_TRACK_RE.test(`${task.title || ""}\n${task.body || ""}`) &&
    !QA_PROFILES.has(String(task.assignee || "").trim())
  );
}

/**
 * Cards completed before this instant keep the R7 obligation they were
 * completed under (v1). A card that only scope-v2 classifies, and that
 * completed before this instant, gets the advisory A17_R7_SCOPE_V2_UNGATED
 * instead of R7. Open cards, and cards completed at or after it, are judged
 * by scope-v2. Decision t_18230e85 §1 adopted option C on the premise "no
 * retroactive cliff". That premise held for the 2026-09-18 board. On the
 * 2026-10-10 board, scope-v2 without an epoch would turn 11 already-closed
 * post-epoch cards red (tests/evidence/t_90a4bd73/README.md §3). This epoch
 * keeps the premise; the architect confirms it at review.
 */
export const R7_V2_EPOCH_ISO = "2026-10-12T00:00:00Z";

/**
 * The v1 classification, frozen. It shipped up to t_90a4bd73. Only used so
 * that a card completed before R7_V2_EPOCH_ISO is enforced exactly as before:
 * v2 never removes an obligation v1 imposed.
 */
const SECURITY_TRACK_V1_RE =
  /\b(packages\/crypto|crypto[\s-]*(primitive|implementation|boundary|module|package)|KDF|AEAD|Argon2id|vault[\s-]*key|bridge[\s-]*protocol|bridge[\s-]*message|autofill)\b/i;
export function isSecurityTrackV1(task) {
  return (
    SECURITY_TRACK_V1_RE.test(`${task.title || ""}\n${task.body || ""}`) &&
    /security/.test(testTypesOf(task)) &&
    !QA_PROFILES.has(String(task.assignee || "").trim())
  );
}
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
  // `id` breaks created_at ties (second resolution): an exception and its
  // withdrawal posted in the same second must keep their posting order
  // (t_b2588ee7 — the withdrawal only acts on an exception recorded before it).
  const comments = sql(dbPath, "SELECT task_id, author, body, created_at FROM task_comments ORDER BY created_at, id");
  const attachments = sql(dbPath, "SELECT task_id, filename, size, uploaded_by, stored_path FROM task_attachments");
  const runs = sql(
    dbPath,
    "SELECT id, task_id, profile, status, outcome, summary, metadata, ended_at, started_at FROM task_runs ORDER BY started_at",
  );
  const links = sql(dbPath, "SELECT parent_id, child_id FROM task_links");
  // Completion events, for the out-of-band completion report (t_5b5b61e2,
  // §5.10). Read tolerantly: a board without `task_events` (an older schema, a
  // minimal fixture) must not make the gate — and the fail-closed hook — fail;
  // the report then says "not available" instead of counting 0.
  let events = null;
  try {
    events = sql(
      dbPath,
      "SELECT id, task_id, run_id, kind, payload, created_at FROM task_events WHERE kind IN ('completed', 'manual_complete') ORDER BY created_at, id",
    );
  } catch {
    events = null;
  }
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
    eventsByTask: events ? byTask(events) : null,
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
 *
 * **Author rule (§3, t_338f47fd).** A *comment* records a verdict only when a
 * QA profile wrote it — the marker path used to accept any author, so one
 * `QA-VERDICT: pass — evidence: …` comment written by `architect`, `frontend`,
 * `dashboard` or any other profile satisfied R1/R2/R3 and the fail-closed
 * completion hook. The marker a non-QA author wrote is *not* a verdict; it is
 * reported by `collectIgnoredVerdicts` (A7_VERDICT_AUTHOR_IGNORED) so the
 * discounting is never silent.
 *
 * Run metadata is deliberately the one author-independent source (§3 row 3):
 * it is the completing run's own structured handoff, and `--pre-complete`
 * evaluation happens before the run that carries it has ended.
 */
export function collectVerdicts(board, task) {
  const found = [];
  for (const c of board.commentsByTask.get(task.id) || []) {
    const text = c.body || "";
    // §3: only a QA profile records a QA verdict — both comment paths, not just
    // the loose one.
    if (!QA_PROFILES.has(String(c.author || "").trim())) continue;
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
    {
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
 * Verdict-shaped records the gate **discounts** (§3, t_338f47fd) — reported so
 * the discounting is never silent (A7/A8):
 *
 *   author_ignored  — a `QA-VERDICT: <token>` comment written by a non-QA
 *                     profile. Before this rule it was accepted as the card's
 *                     verdict, which made every R1/R2/R3 outcome (and the
 *                     fail-closed completion hook) forgeable by any profile
 *                     with board write access to the card.
 *   self_declared   — the operative verdict comes from a run-metadata `verdict`
 *                     written by a non-QA run. Still **accepted** (§3 row 3,
 *                     the documented author-independent source), but a
 *                     self-declared verdict must not be invisible.
 *
 * Returns `{ ignored: [...], selfDeclared: [...] }`.
 */
export function collectDiscountedVerdicts(board, task, operativeVerdict = null) {
  const comments = board.commentsByTask.get(task.id) || [];
  const ignored = [];
  for (const c of comments) {
    const author = String(c.author || "").trim();
    if (QA_PROFILES.has(author)) continue;
    const m = VERDICT_MARKER_RE.exec(c.body || "");
    if (!m) continue;
    ignored.push({ author, raw: m[1], token: normalizeVerdictToken(m[1]), at: c.created_at });
  }
  const selfDeclared = [];
  if (operativeVerdict && operativeVerdict.source === "run-metadata") {
    const author = String(operativeVerdict.author || "").trim();
    if (!QA_PROFILES.has(author)) selfDeclared.push({ author, token: operativeVerdict.token });
  }
  return { ignored, selfDeclared };
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
 *
 * **Author rule (§3, t_338f47fd).** A deferral *marker* is a QA verdict record
 * (`QA-VERDICT: deferred — …`), so only a QA profile may record it: a
 * non-QA-authored `deferred` marker neither satisfies R1 nor blocks a card
 * through R8 (the live instance of the latter was t_f49d448c, where an
 * `architect` marker blocked a card whose QA verdict had landed). The
 * linked-child fallback is untouched — it is board state, not an authored
 * record.
 */
export function collectDeferral(board, task) {
  // Comments arrive in `created_at` order (loadBoard), so the last match is the
  // newest marker — mirroring how collectVerdicts sorts its sources.
  const markers = (board.commentsByTask.get(task.id) || []).filter(
    (c) => QA_PROFILES.has(String(c.author || "").trim()) && DEFERRAL_RE.test(c.body || ""),
  );
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

/**
 * The operative §5.6 exception, plus every exception-shaped record the gate
 * refused (t_b8001b55). A record is refused — reported as A10, never silently —
 * when:
 *   - `quoted`: every occurrence of the key in the comment sits inside a code
 *     span or fenced block. A quote is documentation, not a waiver (same rule as
 *     deferral markers and evidence pointers, `codeRanges`). Live origin: the
 *     comment that *reported* this defect on t_75180b28 quoted the key between
 *     backticks and became that card's operative, irrevocable exception;
 *   - `author`: the comment was not written by an EXCEPTION_AUTHORS profile;
 *   - `security-track`: the card is on the crypto/bridge/auth track. AR-6 needs
 *     an Architect and a QA sign-off there; it is signed, never waived, so no
 *     exception — whoever wrote it — disarms R1/R4/R7 on such a card.
 * The first record that survives all three is the operative exception.
 *
 * Withdrawal (t_b2588ee7). Until then the operative exception was the first
 * record to survive the checks and nothing could replace it: an exception
 * recorded in error was permanent, the one irrevocable object in a gate where
 * everything else is corrected by a *newer* comment (comments are never edited
 * or deleted — that immutability is what makes the audit trail trustworthy).
 *
 * Design choice — an explicit key, `qa-signoff-exception withdrawn: <reason>`,
 * not "the last occurrence wins":
 *   - "last wins" cannot express *no exception*: a later key can only replace
 *     one waiver by another, so a withdrawal would still need a sentinel value,
 *     i.e. an explicit key in disguise;
 *   - it would silently change which reason is operative on every card that
 *     already carries several keys, while the explicit key changes nothing on a
 *     card that never records one (the measured board delta is zero);
 *   - a withdrawal is an audit event in its own right: it is greppable, carries
 *     its own author and reason, and is reported (`X2_EXCEPTION_WITHDRAWN`)
 *     next to the exception it ended, so neither can be forgotten.
 * The cost — one more key to know — is paid in QA_SIGN_OFF_GATE.md §5.6.
 *
 * Semantics: records are replayed in posting order (comments by created_at,
 * id; inside one comment, by position). A withdrawal obeys the same author
 * allowlist and code-span rule as an exception; when it is valid it ends the
 * exception in force at that point, and when no exception is in force it does
 * nothing (`no-exception`). A later valid exception re-arms the waiver. While an
 * exception is in force, a further one is redundant and the first keeps
 * governing (unchanged from t_b8001b55). Refused or no-op withdrawals are
 * reported as `A16_EXCEPTION_WITHDRAWAL_IGNORED`.
 */
function findException(board, task, securityTrack) {
  const ignored = [];
  const withdrawn = [];
  const withdrawalsIgnored = [];
  // t_5b5b61e2: a valid exception recorded while another one is in force
  // changes nothing (the first keeps governing), but it is still a recorded
  // waiver — the bypass report lists it, so it is collected instead of dropped.
  const redundant = [];
  let exception = null;
  for (const c of board.commentsByTask.get(task.id) || []) {
    // Comment timestamp (epoch seconds) — the bypass report's date column.
    const at = c.created_at ?? null;
    const body = c.body || "";
    const hits = [...body.matchAll(EXCEPTION_RE_G)];
    const wHits = [...body.matchAll(WITHDRAWAL_RE_G)];
    if (hits.length === 0 && wHits.length === 0) continue;
    const ranges = codeRanges(body);
    const author = String(c.author || "").trim();
    const allowed = EXCEPTION_AUTHORS.has(author);
    const events = [];

    if (hits.length) {
      const live = hits.find((m) => !insideRanges(m.index, ranges));
      // Kept long here: `safeReason` scans the whole text, THEN truncates (a cut
      // through a secret would leave an unmatched prefix — t_5b5b61e2, AR-2).
      const reason = ((live || hits[0])[1] || "").slice(0, 4000);
      let why = null;
      if (!live) why = "quoted";
      else if (!allowed) why = "author";
      else if (securityTrack) why = "security-track";
      if (why) ignored.push({ author: c.author, reason, why, created_at: at });
      else events.push({ kind: "exception", at: live.index, reason });
    }

    if (wHits.length) {
      const live = wHits.find((m) => !insideRanges(m.index, ranges));
      const reason = String((live || wHits[0])[1] || "").trim().slice(0, 4000);
      let why = null;
      if (!live) why = "quoted";
      else if (!allowed) why = "author";
      if (why) withdrawalsIgnored.push({ author: c.author, reason, why, created_at: at });
      else events.push({ kind: "withdrawal", at: live.index, reason });
    }

    for (const e of events.sort((a, b) => a.at - b.at)) {
      if (e.kind === "exception") {
        if (!exception) exception = { reason: e.reason, author: c.author, created_at: at };
        else redundant.push({ reason: e.reason, author: c.author, created_at: at, governedBy: exception });
      } else if (exception) {
        withdrawn.push({ ...exception, withdrawn_by: c.author, withdrawal_reason: e.reason, withdrawn_at: at });
        exception = null;
      } else {
        withdrawalsIgnored.push({ author: c.author, reason: e.reason, why: "no-exception", created_at: at });
      }
    }
  }
  // A redundant record is part of the active waiver only while the exception it
  // repeated is still the one in force; once that one was withdrawn it is
  // history (a later exception re-arms the waiver on its own record).
  const redundantOut = redundant.map(({ governedBy, ...x }) => ({ ...x, active: governedBy === exception }));
  return { exception, ignored, withdrawn, withdrawalsIgnored, redundant: redundantOut };
}

/**
 * Completions that did NOT go through the `pre_tool_call` hook (t_5b5b61e2;
 * QA_SIGN_OFF_GATE.md §5.10). The hook wraps the `kanban_complete` *tool* only;
 * `hermes kanban complete` from a terminal, a dashboard approval and a direct
 * edit of the board all close a card without it (architect decision #505 on
 * t_75180b28: the CLI path is a deliberate override that is NOT wrapped, and
 * the audit is what makes it visible). Hermes has no `--override "<reason>"`
 * flag; what it does record, and what is read here:
 *
 *   - a `manual_complete` event — a closure written straight into the board,
 *     with `payload.reason`;
 *   - a `completed` event with no run (`payload.closure_method`, when present,
 *     says how — e.g. `human_direct_db_edit`);
 *   - a `completed` event whose run Hermes *synthesized* because no worker had
 *     claimed the card: `_synthesize_ended_run` writes `status = outcome =
 *     'completed'`, while a worker run is ended with `status = 'done'`. That is
 *     the CLI / dashboard path. The run's `profile` is the card's assignee, not
 *     the person who ran the command — Hermes does not record the actor, so the
 *     report says so instead of guessing.
 *
 * Known blind spot (documented, not guessed around): `hermes kanban complete
 * --force` on a card a worker is running closes *that worker's* run, which then
 * looks exactly like a worker completion. A CLI call made from inside a worker
 * with that worker's own `HERMES_KANBAN_RUN_ID` is indistinguishable too.
 *
 * Returns `null` when the board has no readable `task_events` table — the
 * report then says "not available", never 0.
 */
export function collectOutOfBandCompletions(board, task) {
  if (!board.eventsByTask) return null;
  const out = [];
  for (const e of board.eventsByTask.get(task.id) || []) {
    let payload = {};
    try {
      payload = e.payload ? JSON.parse(e.payload) : {};
    } catch {
      payload = {};
    }
    if (!payload || typeof payload !== "object") payload = {};
    const text = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 4000) : null);
    if (e.kind === "manual_complete") {
      out.push({
        at: e.created_at ?? null,
        method: "manual_complete event (direct board edit)",
        actor: safeReason(text(payload.actor) || text(payload.by) || "") || null,
        assignee: task.assignee || null,
        reason: text(payload.reason),
      });
      continue;
    }
    if (e.kind !== "completed") continue;
    const run = e.run_id === null || e.run_id === undefined ? null : board.runsById.get(String(e.run_id));
    let method = null;
    if (e.run_id === null || e.run_id === undefined) {
      method = text(payload.closure_method) ? `completed with no run (${safeReason(text(payload.closure_method)).slice(0, 60)})` : "completed with no run";
    } else if (!run) {
      method = "completed by a run missing from the board";
    } else if (String(run.status || "") === "completed") {
      method = "completed outside a worker run (CLI / dashboard)";
    }
    if (!method) continue;
    out.push({
      at: e.created_at ?? null,
      method,
      actor: null,
      assignee: (run && run.profile) || task.assignee || null,
      reason: text(payload.summary) || text(payload.result) || null,
    });
  }
  return out;
}

function withdrawalIgnoredDetail(x) {
  const who = `"${x.author ?? ""}"`;
  if (x.why === "quoted") {
    return `a qa-signoff-exception withdrawal written by ${who} appears only inside a code span/fence — a quotation, not a withdrawal (§5.6) — ignored`;
  }
  if (x.why === "author") {
    const name = String(x.author || "").trim();
    const id = name === "worker" || name === "" ? " (it names no profile, so no one is accountable for it)" : "";
    return `a qa-signoff-exception withdrawal recorded by ${who}${id} is not from an allowed author (${[...EXCEPTION_AUTHORS].join(", ")}) — ignored, any exception in force still holds`;
  }
  return `a qa-signoff-exception withdrawal recorded by ${who} found no exception in force at that point — no effect`;
}

function exceptionIgnoredDetail(x) {
  const who = `"${x.author ?? ""}"`;
  if (x.why === "quoted") {
    return `a qa-signoff-exception key written by ${who} appears only inside a code span/fence — a quotation, not an exception (§5.6) — ignored`;
  }
  if (x.why === "author") {
    const name = String(x.author || "").trim();
    const id = name === "worker" || name === "" ? " (it names no profile, so no one is accountable for the waiver)" : "";
    return `a qa-signoff-exception recorded by ${who}${id} is not from an allowed author (${[...EXCEPTION_AUTHORS].join(", ")}) — ignored`;
  }
  return `a qa-signoff-exception recorded by ${who} is not applied: this is a security-track card, where AR-6 requires Architect + QA sign-off and exceptions never waive R1/R4/R7 — ignored`;
}

// ─────────────────────────────────────────────────────────────────────────────
// R9 / R10 — code delivered means: PR merged into master, and the required CI
// checks green on the merge commit, read from GitHub at check time
// (t_75180b28; QA_SIGN_OFF_GATE.md §5.9).
//
// Why a mechanical check: completion summaries kept claiming "all CI green"
// while required checks were red on the PR (2026-09-30), and a branch was
// pushed with no PR at all (audit t_8577a5a9). The gate never reads the card's
// own summary for this rule — only GitHub.
//
// Network failure is never a violation: when GitHub cannot be read (offline,
// `gh` missing/unauthenticated, rate limit, protection unreadable) the gate
// emits A11_CI_STATE_UNVERIFIABLE and lets the other rules decide, so a card
// never becomes uncompletable because the network is down (architect decision,
// t_75180b28 comment of 2026-10-05 12:30).
// ─────────────────────────────────────────────────────────────────────────────

/** Cards completed before this instant are outside R9/R10 (the audit skips them). */
export const PR_RULE_EPOCH_ISO = "2026-10-06T00:00:00Z";

/** Repo the board's code cards ship to, when it cannot be read from the checkout. */
export const DEFAULT_GH_REPO = "zeldadil/password-manager";

/** Check-run conclusions GitHub itself accepts for a required check. */
const GREEN_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/** Explicit declaration in the card body: `Deliverable: code` (bold/bullet tolerated). */
const CODE_DELIVERABLE_RE = /^[ \t]*(?:[-*][ \t]+)?\**deliverable\**[ \t]*:[ \t]*\**[ \t]*code\b/im;

export class GitHubUnavailable extends Error {}

function idMentionRe(taskId) {
  return new RegExp(`(?:^|[^0-9a-z_])${taskId.replace(/[^0-9a-z_]/gi, "")}(?![0-9a-z])`, "i");
}

// ── Declarative PR → card link (t_7e8bf917, QA_SIGN_OFF_GATE.md §5.9) ────────
// A PR is linked to a card only when it *declares* it: its head branch is named
// after the card, or its body carries a line `Closes <id>` / `Card: <id>` /
// `Task: <id>` outside code. Any other occurrence of the id (title, prose,
// quote, code) is a *mention*: reported as A14_PR_MENTIONS_CARD, never a link.
// Live origin: PR #114 only quoted t_75180b28 in a fixture and was named by R9
// on that card; the same looseness let a merged PR that merely cites a card
// satisfy R9 without delivering its code.

/** Line opener: optional list bullet, optional bold/italic, keyword, separator. */
const LINK_DECL_HEAD_RE = /^[ ]{0,3}(?:[-*+][ \t]+)?[*_]{0,2}(closes|card|task)[*_]{0,2}[ \t]*(:?)[ \t]*[*_]{0,2}(?=[ \t]*\S)[ \t]*/i;
/** One id of the declared list, bold/italic tolerated. */
const LINK_DECL_ID_RE = /^[*_]{0,2}(t_[0-9a-z]+)[*_]{0,2}(?![0-9a-z_])/i;
/** Separator between declared ids, after an optional `(label)`: `, ` `; ` ` & ` ` and ` ` + `. */
const LINK_DECL_SEP_RE = /^(?:[ \t]*\([^()\n]*\))?[ \t]*(?:,|;|&|\+|\band\b)[ \t]*/i;

/**
 * Body lines that are prose, not code: fenced blocks (``` / ~~~), indented code
 * blocks (4+ spaces or a tab after a blank line or inside one) and inline code
 * spans are removed; everything else is kept line by line.
 */
function proseLines(body) {
  const out = [];
  let fence = null;
  let prevBlank = true;
  let inIndented = false;
  for (const raw of String(body || "").replace(/\r\n?/g, "\n").split("\n")) {
    const fm = /^[ ]{0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && /^[ ]{0,3}[`~]+[ \t]*$/.test(raw)) fence = null;
      prevBlank = false;
      continue;
    }
    if (fm) {
      fence = fm[1];
      prevBlank = false;
      continue;
    }
    const blank = raw.trim() === "";
    const indented = /^(?: {4}|\t)/.test(raw) && !blank;
    if (indented && (prevBlank || inIndented)) {
      inIndented = true;
      prevBlank = false;
      continue;
    }
    if (!blank) inIndented = false;
    prevBlank = blank;
    out.push(raw.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, " "));
  }
  return out;
}

/** Card ids a PR body declares (lower-cased), per the §5.9 vocabulary. */
export function declaredCardIds(body) {
  const ids = new Set();
  for (const line of proseLines(body)) {
    const head = LINK_DECL_HEAD_RE.exec(line);
    if (!head) continue;
    const keyword = head[1].toLowerCase();
    // `Card:` / `Task:` need the colon; `Closes` is the GitHub closing-keyword form.
    if (keyword !== "closes" && !head[2] && !/:/.test(head[0])) continue;
    let rest = line.slice(head[0].length);
    let m = LINK_DECL_ID_RE.exec(rest);
    while (m) {
      ids.add(m[1].toLowerCase());
      rest = rest.slice(m[0].length);
      const sep = LINK_DECL_SEP_RE.exec(rest);
      if (!sep) break;
      rest = rest.slice(sep[0].length);
      m = LINK_DECL_ID_RE.exec(rest);
    }
  }
  return ids;
}

/**
 * How `pr` relates to `taskId`: `{ link: "head-branch" | "body-declaration" }`
 * when it declares the card, `{ mention: [...where] }` when it only mentions it,
 * or null.
 */
export function prCardRelation(pr, taskId) {
  const mention = idMentionRe(taskId);
  const head = typeof pr.headRefName === "string" ? pr.headRefName : "";
  if (head && mention.test(head)) return { link: "head-branch" };
  if (declaredCardIds(pr.body).has(String(taskId).toLowerCase())) return { link: "body-declaration" };
  const where = [];
  if (typeof pr.title === "string" && mention.test(pr.title)) where.push("title");
  if (typeof pr.body === "string" && mention.test(pr.body)) where.push("body");
  return where.length ? { mention: where } : null;
}

/**
 * The GitHub reader. Every method throws GitHubUnavailable on any failure, and
 * every result is memoised for the life of the process (an audit asks for the
 * PR list once, not once per card).
 *
 *   QA_GATE_GITHUB=off             → every call is unavailable (A11)
 *   QA_GATE_GITHUB_FIXTURE=<file>  → answers come from a JSON fixture (selftest)
 *   otherwise                      → the `gh` CLI, with a total time budget so the
 *                                    30 s hook timeout is never reached
 *                                    (QA_GATE_GH_BUDGET_MS, default 20000)
 */
export function makeGitHub({ repo = null, mode = process.env.QA_GATE_GITHUB || "", fixture = process.env.QA_GATE_GITHUB_FIXTURE || "" } = {}) {
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) {
      try {
        memo.set(key, { ok: true, value: fn() });
      } catch (e) {
        memo.set(key, { ok: false, error: e instanceof GitHubUnavailable ? e : new GitHubUnavailable(e.message) });
      }
    }
    const m = memo.get(key);
    if (!m.ok) throw m.error;
    return m.value;
  };

  if (String(mode).toLowerCase() === "off") {
    const off = () => {
      throw new GitHubUnavailable("GitHub lookups disabled (QA_GATE_GITHUB=off / --no-github)");
    };
    return { repo, source: "off", listPullRequests: off, listBranches: off, defaultBranch: off, requiredChecks: off, commitChecks: off };
  }

  if (fixture) {
    let fx;
    try {
      fx = JSON.parse(readFileSync(fixture, "utf8"));
    } catch (e) {
      throw new BoardError(`GitHub fixture unreadable (${fixture}): ${e.message}`);
    }
    const guard = (what) => {
      if (fx.unreachable) throw new GitHubUnavailable(`${what}: ${fx.unreachable}`);
      if (fx.errors && fx.errors[what]) throw new GitHubUnavailable(`${what}: ${fx.errors[what]}`);
    };
    return {
      repo: fx.repo || repo,
      source: `fixture ${fixture}`,
      listPullRequests: () => once("prs", () => (guard("pull requests"), fx.prs || [])),
      listBranches: () => once("branches", () => (guard("branches"), fx.branches || [])),
      defaultBranch: () => once("default", () => (guard("default branch"), fx.default_branch || "master")),
      requiredChecks: (branch) => once(`req:${branch}`, () => (guard("required checks"), fx.required_checks || [])),
      commitChecks: (sha) =>
        once(`checks:${sha}`, () => {
          guard("commit checks");
          return {
            runs: (fx.check_runs || {})[sha] || [],
            statuses: (fx.statuses || {})[sha] || [],
            // Fixtures written before t_339a0d02 carry no workflow runs: null keeps their meaning (no event split).
            workflow_runs: fx.workflow_runs ? (fx.workflow_runs[sha] || []) : null,
          };
        }),
    };
  }

  const budgetMs = Number(process.env.QA_GATE_GH_BUDGET_MS) || 20000;
  const deadline = Date.now() + budgetMs;
  const gh = (args) => {
    const left = deadline - Date.now();
    if (left <= 500) throw new GitHubUnavailable(`GitHub time budget (${budgetMs} ms) exhausted`);
    try {
      return execFileSync("gh", args, {
        encoding: "utf8",
        timeout: Math.min(10000, left),
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" },
      });
    } catch (e) {
      if (e.code === "ENOENT") throw new GitHubUnavailable("`gh` CLI not on PATH");
      const detail = (e.stderr || e.message || "").toString().trim().split("\n")[0].slice(0, 200);
      throw new GitHubUnavailable(`gh ${args.slice(0, 2).join(" ")} failed: ${detail || (e.signal ? `killed by ${e.signal} (timeout)` : "error")}`);
    }
  };
  const jsonLines = (out) =>
    out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const need = () => {
    if (!repo) throw new GitHubUnavailable("no GitHub repository resolved (--gh-repo / QA_GATE_GH_REPO / origin remote)");
    return repo;
  };
  return {
    repo,
    source: "gh",
    listPullRequests: () =>
      once("prs", () =>
        JSON.parse(
          gh([
            "pr", "list", "--repo", need(), "--state", "all", "--limit", "5000",
            "--json", "number,title,body,state,mergedAt,mergeCommit,baseRefName,headRefName,url",
          ]),
        ),
      ),
    listBranches: () => once("branches", () => gh(["api", "--paginate", `repos/${need()}/branches?per_page=100`, "--jq", ".[].name"]).split("\n").map((s) => s.trim()).filter(Boolean)),
    defaultBranch: () => once("default", () => gh(["api", `repos/${need()}`, "--jq", ".default_branch"]).trim() || "master"),
    requiredChecks: (branch) =>
      once(`req:${branch}`, () => {
        const rsc = JSON.parse(gh(["api", `repos/${need()}/branches/${branch}/protection/required_status_checks`]));
        if (Array.isArray(rsc.checks) && rsc.checks.length) return rsc.checks.map((c) => ({ context: c.context, app_id: c.app_id ?? null }));
        return (rsc.contexts || []).map((c) => ({ context: c, app_id: null }));
      }),
    commitChecks: (sha) =>
      once(`checks:${sha}`, () => ({
        runs: jsonLines(
          gh([
            "api", "--paginate", `repos/${need()}/commits/${sha}/check-runs?per_page=100`,
            "--jq", ".check_runs[] | {name, status, conclusion, app_id: .app.id, id, check_suite_id: .check_suite.id}",
          ]),
        ),
        statuses: jsonLines(gh(["api", `repos/${need()}/commits/${sha}/status`, "--jq", ".statuses[] | {context, state}"])),
        // Which check suite is the push run (t_339a0d02): every workflow run of the SHA, with its event.
        workflow_runs: jsonLines(
          gh([
            "api", "--paginate", `repos/${need()}/actions/runs?head_sha=${sha}&per_page=100`,
            "--jq", ".workflow_runs[] | {id, event, run_attempt, check_suite_id}",
          ]),
        ),
      })),
  };
}

/** `owner/name` from a GitHub remote URL (https or ssh), or null. */
export function parseGitHubSlug(url) {
  const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url || "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export function resolveGitHubRepo(argRepo, repoRoot) {
  if (typeof argRepo === "string" && argRepo) return argRepo;
  if (process.env.QA_GATE_GH_REPO) return process.env.QA_GATE_GH_REPO;
  if (repoRoot && existsSync(join(repoRoot, ".git"))) {
    try {
      const url = execFileSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
      const slug = parseGitHubSlug(url);
      if (slug) return slug;
    } catch {
      /* no origin — fall through */
    }
  }
  return DEFAULT_GH_REPO;
}

/** State of one required check on a commit: "success" | "failure" | "in_progress" | "missing" | "no-push-run" | …
 *
 * §5.9 / t_339a0d02 — only the run triggered by the merge counts: the `push`
 * run on the merge commit. When the reader knows the workflow runs of the SHA
 * (`checks.workflow_runs`, an array), a check run whose check suite belongs to
 * a non-push workflow run (workflow_dispatch, schedule, …) is set aside: it is
 * reported in `manual_state` (advisory A15), never judged. A check run whose
 * suite no workflow run owns (another app) is judged as before. Within one
 * suite only the newest check run of a name counts, so a re-run of the push run
 * (same suite, new attempt) replaces its earlier attempt.
 */
function latestPerSuite(runs) {
  const loose = [];
  const bySuite = new Map();
  for (const r of runs) {
    if (r.check_suite_id === null || r.check_suite_id === undefined || r.id === null || r.id === undefined) {
      loose.push(r);
      continue;
    }
    const k = String(r.check_suite_id);
    const cur = bySuite.get(k);
    if (!cur || Number(r.id) > Number(cur.id)) bySuite.set(k, r);
  }
  return loose.concat([...bySuite.values()]);
}

function splitRunsByEvent(runs, workflowRuns) {
  if (!Array.isArray(workflowRuns)) return { judged: latestPerSuite(runs), manual: [] };
  const eventOf = new Map(workflowRuns.filter((w) => w && w.check_suite_id !== undefined && w.check_suite_id !== null).map((w) => [String(w.check_suite_id), String(w.event || "")]));
  const judged = [];
  const manual = [];
  for (const r of runs) {
    const ev = r.check_suite_id === null || r.check_suite_id === undefined ? undefined : eventOf.get(String(r.check_suite_id));
    if (ev === undefined || ev === "push") judged.push(r);
    else manual.push({ ...r, event: ev });
  }
  return { judged: latestPerSuite(judged), manual: latestPerSuite(manual) };
}

const runState = (r) => (r.status !== "completed" ? r.status || "pending" : String(r.conclusion || "no-conclusion").toLowerCase());

function requiredCheckState(req, checks) {
  const named = checks.runs.filter((r) => r.name === req.context && (req.app_id === null || req.app_id === undefined || Number(r.app_id) === Number(req.app_id)));
  const { judged: runs, manual } = splitRunsByEvent(named, checks.workflow_runs);
  let newestManual = null;
  for (const m of manual) if (!newestManual || Number(m.id) > Number(newestManual.id)) newestManual = m;
  const manualInfo = newestManual ? { manual_state: runState(newestManual), manual_event: newestManual.event } : {};
  if (runs.length) {
    const notDone = runs.find((r) => r.status !== "completed");
    if (notDone) return { green: false, state: notDone.status || "pending", ...manualInfo };
    const bad = runs.find((r) => !GREEN_CONCLUSIONS.has(String(r.conclusion || "").toLowerCase()));
    if (bad) return { green: false, state: String(bad.conclusion || "no-conclusion").toLowerCase(), ...manualInfo };
    return { green: true, state: String(runs[0].conclusion).toLowerCase(), ...manualInfo };
  }
  // Legacy commit statuses only count when the requirement is not bound to an app.
  if (req.app_id === null || req.app_id === undefined) {
    const st = checks.statuses.find((s) => s.context === req.context);
    if (st) return { green: st.state === "success", state: st.state, ...manualInfo };
  }
  // Only manual runs carry this check: fail closed, a manual run never satisfies R10.
  if (newestManual) return { green: false, state: "no-push-run", ...manualInfo };
  return { green: false, state: "missing" };
}

/**
 * R9/R10 for one card. Pure with respect to the injected GitHub reader.
 * Returns `{ violations, advisories, facts }` (facts = the `pr_rule` block).
 */
export function evaluatePrRule(task, gh) {
  const violations = [];
  const advisories = [];
  const add = (rule, detail) => violations.push({ rule, detail });
  const advise = (rule, detail) => advisories.push({ rule, detail });
  const facts = { in_scope: true, repo: gh.repo || null, applies: null, linked_prs: [], judged_pr: null, required_checks: null, check_states: null };
  const unverifiable = (step, e) => {
    facts.unverifiable = `${step}: ${e.message}`;
    advise(
      "A11_CI_STATE_UNVERIFIABLE",
      `could not read ${step} from GitHub (${e.message}) — the PR-merged / merge-commit-CI rule (§5.9) was not evaluated for this card; not a violation, re-run the check when GitHub is reachable`,
    );
    return { violations, advisories, facts };
  };

  const mention = idMentionRe(task.id);
  let prs;
  try {
    prs = gh.listPullRequests();
  } catch (e) {
    return unverifiable("the pull-request list", e);
  }
  const shape = (pr, rel) => ({
    number: pr.number,
    state: String(pr.state || "").toUpperCase(),
    merged: Boolean(pr.mergedAt) || String(pr.state || "").toUpperCase() === "MERGED",
    merged_at: pr.mergedAt || null,
    base: pr.baseRefName || null,
    head: pr.headRefName || null,
    merge_commit: (pr.mergeCommit && pr.mergeCommit.oid) || null,
    url: pr.url || null,
    ...(rel.link ? { link: rel.link } : { mentioned_in: rel.mention }),
  });
  // Only a declaration links (t_7e8bf917): head branch named after the card, or a
  // `Closes <id>` / `Card: <id>` / `Task: <id>` body line outside code.
  const linked = [];
  const mentioning = [];
  for (const pr of prs) {
    const rel = prCardRelation(pr, task.id);
    if (!rel) continue;
    (rel.link ? linked : mentioning).push(shape(pr, rel));
  }
  facts.linked_prs = linked;
  facts.mentioning_prs = mentioning;
  // A14 — a mention is never a link and never a violation, but it stays visible.
  if (mentioning.length) {
    const desc = (p) => `#${p.number} (${p.merged ? "merged" : p.state.toLowerCase() || "unknown state"}; ${p.mentioned_in.join(" + ")})`;
    advise(
      "A14_PR_MENTIONS_CARD",
      `PR ${mentioning.map(desc).join(", ")} mention${mentioning.length === 1 ? "s" : ""} ${task.id} without declaring it — not linked: neither counted for nor against §5.9. If one of them delivers this card, add a \`Closes ${task.id}\` line to its body (or name its head branch after the card)`,
    );
  }

  if (linked.length === 0) {
    const declared = CODE_DELIVERABLE_RE.test(task.body || "");
    let branches;
    try {
      branches = gh.listBranches().filter((b) => mention.test(b));
    } catch (e) {
      if (!declared) return unverifiable("the branch list", e);
      branches = [];
    }
    facts.pushed_branches = branches;
    if (!declared && branches.length === 0) {
      facts.applies = false;
      facts.reason = "no PR declares the card (head branch named after it, or a `Closes`/`Card:`/`Task:` body line), no pushed branch is named after it, and its body does not declare `Deliverable: code`";
      return { violations, advisories, facts };
    }
    facts.applies = true;
    const why = branches.length ? `branch(es) ${branches.map((b) => `\`${b}\``).join(", ")} are pushed` : "the card body declares `Deliverable: code`";
    add(
      "R9_PR_NOT_MERGED",
      `no pull request declares ${task.id} (head branch named after the card, or a \`Closes ${task.id}\` / \`Card: ${task.id}\` / \`Task: ${task.id}\` line in its body — a mention in the title or prose does not link)${mentioning.length ? `, only mention(s): ${mentioning.map((p) => `#${p.number}`).join(", ")}` : ""}, yet ${why} — code is delivered only through a PR merged into master: open the PR with \`Closes ${task.id}\` in its body, move the card to review with "PR: #<n>", and let the merger complete it (§5.9)`,
    );
    return { violations, advisories, facts };
  }

  facts.applies = true;
  let base;
  try {
    base = gh.defaultBranch();
  } catch (e) {
    return unverifiable("the default branch", e);
  }
  facts.default_branch = base;
  const mergedToBase = linked
    .filter((p) => p.merged && p.base === base && p.merge_commit)
    .sort((a, b) => String(b.merged_at || "").localeCompare(String(a.merged_at || "")));
  if (mergedToBase.length === 0) {
    const describe = (p) =>
      p.merged
        ? `#${p.number} merged into \`${p.base}\`, not \`${base}\``
        : p.state === "OPEN"
          ? `#${p.number} is open (not merged)`
          : `#${p.number} was closed without being merged`;
    add(
      "R9_PR_NOT_MERGED",
      `PR not merged: no pull request linked to ${task.id} is merged into ${base} — ${linked.map(describe).join("; ")}. The card completes after the merge, by the merger (§5.9)`,
    );
    return { violations, advisories, facts };
  }

  const pr = mergedToBase[0];
  facts.judged_pr = pr.number;
  facts.merge_commit = pr.merge_commit;
  for (const p of linked) {
    if (p !== pr && p.state === "OPEN") {
      advise("A12_LINKED_PR_OPEN", `PR #${p.number} also declares ${task.id} and is still open — not judged (PR #${pr.number} is the merged one); make sure no part of this card's deliverable lives only there`);
    }
  }

  let required;
  try {
    required = gh.requiredChecks(base);
  } catch (e) {
    return unverifiable(`the required status checks of \`${base}\` (branch protection)`, e);
  }
  facts.required_checks = required.map((r) => r.context);
  if (required.length === 0) {
    return unverifiable(`the required status checks of \`${base}\``, new GitHubUnavailable("branch protection lists no required check"));
  }
  let checks;
  try {
    checks = gh.commitChecks(pr.merge_commit);
  } catch (e) {
    return unverifiable(`the checks of merge commit ${pr.merge_commit.slice(0, 12)}`, e);
  }
  const states = required.map((r) => ({ context: r.context, ...requiredCheckState(r, checks) }));
  facts.check_states = Object.fromEntries(states.map((s) => [s.context, s.state]));
  const diverging = states.filter((s) => s.manual_state && s.manual_state !== s.state);
  if (diverging.length) {
    facts.manual_check_states = Object.fromEntries(diverging.map((s) => [s.context, `${s.manual_state} (${s.manual_event})`]));
    advise(
      "A15_NON_PUSH_RUN_ON_MERGE_COMMIT",
      `non-push run(s) on merge commit ${pr.merge_commit.slice(0, 12)} of PR #${pr.number} disagree with its push run: ${diverging.map((s) => `${s.context}=${s.manual_state} (${s.manual_event}; push run: ${s.state})`).join(", ")} — not judged: R10 reads only the run the merge triggered (the push run, latest attempt included); a manual run can neither break nor repair it (§5.9, t_339a0d02)`,
    );
  }
  const notGreen = states.filter((s) => !s.green);
  if (notGreen.length) {
    add(
      "R10_MERGE_CI_NOT_GREEN",
      `PR #${pr.number} is merged, but CI is not green on its merge commit ${pr.merge_commit.slice(0, 12)} on ${base}: ${notGreen.map((s) => `${s.context}=${s.state}`).join(", ")} (${required.length} required check(s) read from the ${base} branch protection). Fix master or wait for its run to finish; a cancelled run can be re-run with \`gh run rerun\` (§5.9)`,
    );
  }
  // A13 — the newest merged PR is the one judged (its merge commit contains every
  // earlier merge of the card), but an earlier merge that landed red must not
  // vanish: live case, FE-002g/FE-003a code PR merged with secret-scan=failure
  // on master, then a green evidence PR for the same cards (t_75180b28 evidence).
  for (const older of mergedToBase.slice(1, 6)) {
    let oc;
    try {
      oc = gh.commitChecks(older.merge_commit);
    } catch {
      continue;
    }
    const bad = required.map((r) => ({ context: r.context, ...requiredCheckState(r, oc) })).filter((s) => !s.green);
    if (bad.length) {
      advise(
        "A13_EARLIER_MERGE_CI_NOT_GREEN",
        `earlier PR #${older.number} of this card merged as ${older.merge_commit.slice(0, 12)} with required check(s) not green there: ${bad.map((s) => `${s.context}=${s.state}`).join(", ")} — not a violation (the newest merge, PR #${pr.number}, is judged and contains it), recorded so it is never silent`,
      );
    }
  }
  return { violations, advisories, facts };
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
  // Classified before the exception lookup: on a security-track card the
  // exception is refused outright (t_b8001b55, AR-6 — signed, never waived).
  // scope-v2 (t_90a4bd73): the Test Type is not consulted any more.
  // `securityTrack` is the classification. `securityTrackEnforced` adds the
  // R7_V2_EPOCH_ISO cut-over: a card completed before it is enforced only if
  // v1 classified it.
  const securityTrack = isSecurityTrack(task);
  const r7v2EpochMs = opts.r7v2EpochMs ?? Date.parse(R7_V2_EPOCH_ISO);
  const r7v2InForce = preComplete || task.status !== "done" || (completedMs !== null && completedMs >= r7v2EpochMs);
  const securityTrackEnforced = (securityTrack && r7v2InForce) || isSecurityTrackV1(task);
  const {
    exception,
    ignored: exceptionsIgnored,
    withdrawn: exceptionsWithdrawn,
    withdrawalsIgnored,
    redundant: exceptionsRedundant,
  } = findException(board, task, securityTrackEnforced);
  const outOfBand = collectOutOfBandCompletions(board, task);

  const verdicts = collectVerdicts(board, task);
  const valid = verdicts.filter((v) => VERDICTS.has(v.token));
  // `deferred` is a legal marker value but not a verdict — §5.4 handles it (R8).
  const invalidAll = verdicts.filter((v) => v.token && !VERDICTS.has(v.token) && v.token !== "deferred");
  // A verdict comment is immutable audit history, so an off-vocabulary token can
  // never be taken back — only superseded. R5 already resolves the **operative
  // (newest)** verdict only; R2 must use the same rule or a single mistyped token
  // blocks the card forever and the only "fix" is editing the audit trail
  // (t_c015bda7). An invalid token is a violation only when no VALID verdict was
  // recorded after it; a later valid verdict demotes it to an advisory. The
  // ordering matters in one direction only: valid-then-invalid still fires R2,
  // so a good verdict can never mask a bad one that followed it.
  const lastValidAt = valid.length ? valid[valid.length - 1].at : null;
  const supersededBy = (v) => {
    if (lastValidAt === null) return null;
    const after = valid.filter((w) => (w.at ?? 0) > (v.at ?? 0));
    return after.length ? after[after.length - 1] : null;
  };
  const invalid = invalidAll.filter((v) => !supersededBy(v));
  const invalidSuperseded = invalidAll
    .filter((v) => supersededBy(v))
    .map((v) => ({ raw: v.raw, token: v.token, author: v.author, at: v.at, replacedBy: supersededBy(v) }));
  const deferral = collectDeferral(board, task);
  // Verdict-shaped records the gate discounts (§3 author rule, t_338f47fd):
  // non-QA marker comments (ignored) and a non-QA run-metadata verdict (accepted
  // as the one documented author-independent source, but reported). Both are
  // advisories — they change visibility, never the verdict set.
  const discounted = collectDiscountedVerdicts(board, task, valid.length ? valid[valid.length - 1] : null);
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
    // Reasons are free text: printed only through safeReason (AR-2, t_5b5b61e2),
    // so the JSON document the workflow uploads carries no secret-shaped value.
    exception: exception ? { ...exception, reason: safeReason(exception.reason) } : null,
    exceptions_ignored: exceptionsIgnored.map((x) => ({ ...x, reason: safeReason(x.reason) })),
    exceptions_withdrawn: exceptionsWithdrawn.map((x) => ({ ...x, reason: safeReason(x.reason), withdrawal_reason: safeReason(x.withdrawal_reason) })),
    exception_withdrawals_ignored: withdrawalsIgnored.map((x) => ({ ...x, reason: safeReason(x.reason) })),
    exceptions_redundant: exceptionsRedundant.map((x) => ({ ...x, reason: safeReason(x.reason) })),
    out_of_band_completions: outOfBand ? outOfBand.map((x) => ({ ...x, reason: x.reason ? safeReason(x.reason) : null })) : null,
    discounted_verdicts: {
      ignored: discounted.ignored,
      self_declared: discounted.selfDeclared,
    },
  };

  // R2 — a verdict token outside the §12 vocabulary.
  for (const v of invalid) {
    add(
      "R2_QA_VERDICT_INVALID",
      `verdict "${v.raw}" (${v.source}${v.author ? ` by ${v.author}` : ""}) is not one of: ${[...VERDICTS].join(", ")}`,
    );
  }

  // A9 — an off-vocabulary token that a later valid verdict superseded. Reported
  // so the correction stays visible in the audit trail instead of vanishing
  // silently: the mistyped token is still part of the card's history, it just no
  // longer blocks the card (t_c015bda7).
  for (const v of invalidSuperseded) {
    advise(
      "A9_VERDICT_SUPERSEDED",
      `off-vocabulary verdict "${v.raw}"${v.author ? ` by ${v.author}` : ""} superseded by a later valid "${v.replacedBy.token}"${v.replacedBy.author ? ` by ${v.replacedBy.author}` : ""} — not a violation, recorded for the audit trail`,
    );
  }

  // A7/A8 — the §3 author rule, reported so discounting is never silent
  // (t_338f47fd). Advisories only: neither changes which sources are accepted.
  for (const ig of discounted.ignored) {
    advise(
      "A7_VERDICT_AUTHOR_IGNORED",
      `a \`QA-VERDICT: ${ig.raw}\` comment written by "${ig.author}" is not a QA verdict (§3: only a qa-profile comment records one) — ignored`,
    );
  }
  for (const sd of discounted.selfDeclared) {
    advise(
      "A8_VERDICT_SELF_DECLARED",
      `the operative verdict "${sd.token}" comes from the run metadata of a "${sd.author}" run — accepted per §3 (the one author-independent source), but it is a self-declaration, not a QA review`,
    );
  }

  // A10 — exception-shaped records the gate refused (t_b8001b55): quoted in
  // code, written by a non-allowed author, or on a security-track card. Never
  // silent, so a refused waiver can't be mistaken for an applied one.
  for (const x of exceptionsIgnored) advise("A10_EXCEPTION_IGNORED", exceptionIgnoredDetail(x));

  // X2 / A11 — the withdrawal trail (t_b2588ee7). A withdrawn exception waives
  // nothing any more, but it stays visible, with who ended it and why; a refused
  // or no-op withdrawal is reported so it cannot be mistaken for an applied one.
  for (const w of exceptionsWithdrawn) {
    advise(
      "X2_EXCEPTION_WITHDRAWN",
      `QA sign-off exception recorded by ${w.author} (${safeReason(w.reason)}) was withdrawn by ${w.withdrawn_by}${w.withdrawal_reason ? `: ${safeReason(w.withdrawal_reason)}` : " (no reason given)"} — no longer applied`,
    );
  }
  for (const x of withdrawalsIgnored) advise("A16_EXCEPTION_WITHDRAWAL_IGNORED", withdrawalIgnoredDetail(x));

  // X3 — the card was closed without the completion hook (CLI, dashboard,
  // direct board edit; t_5b5b61e2, §5.10). Never a violation: the override is
  // legitimate (architect decision #505 on t_75180b28), the audit trail is the
  // control. The rules above still judge the card as it stands.
  for (const o of outOfBand || []) {
    advise(
      "X3_COMPLETED_OUTSIDE_HOOK",
      `${o.method} on ${isoDay(o.at)}${o.actor ? ` by ${o.actor}` : " — actor not recorded by Hermes"}${o.assignee ? ` (assignee ${o.assignee})` : ""}: ${o.reason ? safeReason(o.reason) : "(no reason recorded)"}`,
    );
  }

  // R1 — a QA verdict, or a resolvable QA deferral, must exist.
  if (exception) {
    advisories.push({ rule: "X1_EXCEPTION", detail: `QA sign-off exception recorded by ${exception.author}: ${safeReason(exception.reason)}` });
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
  // `securityTrack` is classified at the top of evaluateCard. R7 deliberately
  // does not consult the exception (t_b8001b55): an Architect signature is
  // signed, never waived — findException already refuses it on this track, and
  // this condition holds even if that ever regressed.
  facts.security_track = securityTrack;
  facts.security_track_enforced = securityTrackEnforced;
  const archSigned = hasArchitectSignoff(board, task);
  if (securityTrackEnforced && postEpoch && !archSigned) {
    add("R7_SECURITY_TRACK_SIGNOFF_MISSING", "crypto/bridge/auth card carries no Architect sign-off comment (AR-6)");
  } else if (securityTrack && !securityTrackEnforced && !archSigned) {
    advise(
      "A17_R7_SCOPE_V2_UNGATED",
      `crypto/bridge card under R7 scope-v2, completed before its epoch ${new Date(r7v2EpochMs).toISOString()} — no Architect sign-off comment (AR-6); reported, not enforced`,
    );
  }

  // R9/R10 — code cards: PR merged into master + required CI green on the merge
  // commit, read from GitHub now (§5.9, t_75180b28). Its own epoch: a card
  // completed before it is not re-judged (no lookup, no advisory). A §5.6
  // exception does NOT waive it — it is a fact about the repository, not about
  // the QA record.
  const prEpochMs = opts.prEpochMs ?? Date.parse(PR_RULE_EPOCH_ISO);
  const prInScope = preComplete || task.status !== "done" || (completedMs !== null && completedMs >= prEpochMs);
  if (!prInScope) {
    facts.pr_rule = { in_scope: false, reason: `completed before the PR-rule epoch ${new Date(prEpochMs).toISOString()}` };
  } else if (!opts.github) {
    facts.pr_rule = { in_scope: true, applies: null, reason: "no GitHub reader supplied to evaluateCard" };
  } else {
    const pr = evaluatePrRule(task, opts.github);
    facts.pr_rule = pr.facts;
    violations.push(...pr.violations);
    advisories.push(...pr.advisories);
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

/** Rule id of the "GitHub could not be read" advisory (§5.9). */
export const A11_RULE = "A11_CI_STATE_UNVERIFIABLE";

/** `2026-10-05 20:36 UTC` for an epoch-seconds board timestamp; `date unknown` otherwise. */
export function isoDay(at) {
  const n = Number(at);
  if (at === null || at === undefined || !Number.isFinite(n) || n <= 0) return "date unknown";
  return `${new Date(n * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * A free-text reason, made safe to print (AR-2, t_5b5b61e2): control characters
 * flattened, length capped, and the whole reason withheld — naming only the
 * secret-guard rule ids, never the value — when it carries a secret shape.
 * When the scanner could not be loaded the reason is withheld too.
 */
export function safeReason(reason) {
  if (reason === null || reason === undefined || reason === "") return "";
  // Control characters flattened; fence-length backtick/tilde runs shortened, so
  // a reason cannot close the ```text fence the workflow wraps the report in.
  const flat = String(reason)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/`{3,}/g, "`")
    .replace(/~{3,}/g, "~")
    .trim();
  if (typeof secretScanText !== "function") return "[reason withheld: secret scanner (secret-guard.mjs) unavailable]";
  // Scan the WHOLE text before truncating: a cut through a secret would leave a
  // prefix too short to match and print it.
  const hits = secretScanText(flat);
  return hits.length ? `[reason withheld: matches ${hits.join(", ")} — read it on the card]` : flat.slice(0, 200);
}

/**
 * Watch thresholds for the bypass trend (t_5b5b61e2, criterion 3): occurrences
 * in the 30 days before the audit above which the report says "above watch
 * threshold". A threshold NEVER fails the audit — an exception or an override is
 * legitimate, and a red CI for it would only teach people to bypass it another
 * way. It is a prompt to look, named in the output so nobody has to compute it.
 * Policy values (QA_SIGN_OFF_GATE.md §5.10), tunable by the architect.
 */
export const BYPASS_WATCH_30D = { x1: 2, x2: 2, x3: 10 };

const DAY_S = 86400;

/** Per-month counts + the last-30-days / previous-30-days pair for a list of records. */
export function bypassTrend(records, nowMs, threshold) {
  const now = Math.floor(nowMs / 1000);
  const byMonth = {};
  let last30 = 0;
  let prev30 = 0;
  let undated = 0;
  for (const r of records) {
    const at = Number(r.at);
    if (!Number.isFinite(at) || at <= 0) {
      undated++;
      continue;
    }
    const m = new Date(at * 1000).toISOString().slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
    if (at > now - 30 * DAY_S && at <= now) last30++;
    else if (at > now - 60 * DAY_S && at <= now - 30 * DAY_S) prev30++;
  }
  const sorted = Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)));
  return {
    by_month: sorted,
    last_30d: last30,
    previous_30d: prev30,
    undated,
    direction: last30 > prev30 ? "rising" : last30 < prev30 ? "falling" : "flat",
    watch_threshold_30d: threshold ?? null,
    above_watch: threshold !== null && threshold !== undefined && last30 > threshold,
    as_of: new Date(nowMs).toISOString(),
  };
}

/** Exception records of a card, for the X1 report: the one in force first, then the redundant ones that repeat it. */
function exceptionRecordsOf(r) {
  const f = r.facts;
  if (!f.exception) return [];
  const out = [{ at: f.exception.created_at ?? null, author: f.exception.author, reason: safeReason(f.exception.reason), state: "in force" }];
  for (const x of (f.exceptions_redundant || []).filter((y) => y.active)) {
    out.push({ at: x.created_at ?? null, author: x.author, reason: safeReason(x.reason), state: "redundant — repeats the exception in force" });
  }
  return out;
}

/** Withdrawn exceptions of a card, for the X2 (history) report. */
function withdrawnRecordsOf(r) {
  const f = r.facts;
  const out = [];
  for (const w of f.exceptions_withdrawn || []) {
    out.push({
      at: w.created_at ?? null,
      author: w.author,
      reason: safeReason(w.reason),
      state: `withdrawn by ${w.withdrawn_by} on ${isoDay(w.withdrawn_at)}${w.withdrawal_reason ? `: ${safeReason(w.withdrawal_reason)}` : " (no reason given)"}`,
    });
  }
  for (const x of (f.exceptions_redundant || []).filter((y) => !y.active)) {
    out.push({ at: x.created_at ?? null, author: x.author, reason: safeReason(x.reason), state: "redundant when recorded — the exception it repeated was withdrawn" });
  }
  return out;
}

/** Out-of-band completions of a card, for the X3 report (null = events not readable). */
function outOfBandRecordsOf(r) {
  const list = r.facts.out_of_band_completions;
  if (list === null || list === undefined) return null;
  return list.map((o) => ({
    at: o.at,
    author: o.actor || "not recorded",
    reason: o.reason ? safeReason(o.reason) : "(no reason recorded)",
    state: `${o.method}${o.assignee ? ` · assignee ${o.assignee}` : ""}`,
  }));
}

/**
 * "Bypasses and degradations" — ONE block of the audit report, one entry per
 * type (t_b102b100; architect design note on the card, shared with
 * t_5b5b61e2). Each type is counted and its cards listed on every audit, so a
 * board whose only problem is "GitHub was not read" (or, later, "an exception
 * waived the rules") never looks silently green. A type never turns a card
 * into a violation; whether it may turn the *audit* red is the type's own
 * `failsAudit(opts)`:
 *   - A11 → only with `--fail-on-a11` (§5.9: a GitHub outage must never make a
 *     card uncompletable, but a scheduled audit that runs WITH GitHub and
 *     still gets A11 is a real degradation);
 *   - the bypasses (t_5b5b61e2, QA_SIGN_OFF_GATE.md §5.10): X1 sign-off
 *     exceptions in force, X2 withdrawn exceptions (history, not an active
 *     bypass — consistent with t_b2588ee7), X3 completions made outside the
 *     completion hook (CLI / dashboard / direct board edit). All three have
 *     `failsAudit: () => false`: a bypass is made VISIBLE, it never turns the
 *     audit red (an exception that broke CI would only be bypassed another way).
 * `detail(r)` returns the per-card detail string, or null when the card does
 * not carry the type. `records(r)` (bypass types) returns one row per
 * occurrence — `{ at, author, reason, state }` — or null when the type could
 * not be read for that card (the entry is then `available: false`, never 0);
 * a bypass type also reports a per-month trend and its 30-day watch threshold
 * (`BYPASS_WATCH_30D`).
 */
const recordsDetail = (recs) =>
  recs.length ? recs.map((x) => `${isoDay(x.at)} · ${x.author} · ${x.reason || "(no reason)"} · ${x.state}`).join(" | ") : null;

export const DEGRADATION_TYPES = [
  {
    key: "a11",
    rule: A11_RULE,
    label: "CI state unverifiable — R9/R10 not evaluated",
    tag: "A11: CI state unverified — §5.9 not evaluated",
    annotation: "A11 CI state unverifiable",
    failFlag: "--fail-on-a11",
    failsAudit: (opts) => Boolean(opts.failOnA11),
    detail: (r) => {
      const a = r.advisories.find((x) => x.rule === A11_RULE);
      return a ? a.detail : null;
    },
  },
  {
    key: "x1",
    rule: "X1_EXCEPTION",
    label: "QA sign-off exception in force (§5.6) — R1/evidence waived",
    tag: "X1: QA sign-off exception in force",
    annotation: "X1 sign-off exception",
    annotate: "per-record",
    failFlag: null,
    failsAudit: () => false,
    records: exceptionRecordsOf,
  },
  {
    key: "x2",
    rule: "X2_EXCEPTION_WITHDRAWN",
    label: "QA sign-off exception withdrawn (§5.6) — history, not in force",
    tag: "X2: exception withdrawn (history)",
    annotation: "X2 exception withdrawn",
    annotate: "aggregate",
    failFlag: null,
    failsAudit: () => false,
    records: withdrawnRecordsOf,
  },
  {
    key: "x3",
    rule: "X3_COMPLETED_OUTSIDE_HOOK",
    label: "completed outside the completion hook (CLI / dashboard / direct board edit, §5.10)",
    tag: "X3: completed outside the hook",
    annotation: "X3 completed outside the hook",
    annotate: "aggregate",
    failFlag: null,
    failsAudit: () => false,
    records: outOfBandRecordsOf,
  },
];

/**
 * Evaluated "bypasses and degradations" block, in DEGRADATION_TYPES order
 * (JSON-safe). `opts.nowMs` anchors the 30-day trend window (default: now).
 */
export function degradations(results, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  return DEGRADATION_TYPES.map((t) => {
    const cards = [];
    const allRecords = [];
    let unreadable = 0;
    for (const r of results) {
      if (t.records) {
        const recs = t.records(r);
        if (recs === null || recs === undefined) {
          unreadable++;
          continue;
        }
        if (!recs.length) continue;
        cards.push({ task_id: r.facts.task_id, title: r.facts.title || "", detail: recordsDetail(recs), records: recs });
        for (const x of recs) allRecords.push({ task_id: r.facts.task_id, ...x });
      } else {
        const detail = t.detail(r);
        if (detail !== null && detail !== undefined) cards.push({ task_id: r.facts.task_id, title: r.facts.title || "", detail });
      }
    }
    const flagOn = t.failsAudit(opts);
    const entry = {
      key: t.key,
      rule: t.rule,
      label: t.label,
      annotation: t.annotation,
      count: cards.length,
      task_ids: cards.map((c) => c.task_id),
      fail_flag: t.failFlag || null,
      fail_flag_on: flagOn,
      fails_audit: flagOn && cards.length > 0,
      cards,
    };
    if (t.records) {
      // Not readable for some card (a board without `task_events`): the count
      // would be a guess — say so, never report a reassuring 0.
      entry.available = unreadable === 0;
      if (unreadable) entry.unavailable_reason = `${unreadable} card(s) could not be read for ${t.rule} (no readable task_events table on this board)`;
      entry.annotate = t.annotate || "per-card";
      entry.occurrences = allRecords.length;
      entry.trend = bypassTrend(allRecords, nowMs, BYPASS_WATCH_30D[t.key]);
    }
    return entry;
  });
}

function renderReport(results, opts, out) {
  const enforced = results.filter((r) => r.facts.post_epoch);
  const history = results.filter((r) => !r.facts.post_epoch);
  const failed = results.filter((r) => r.violations.length > 0);
  const enforcedFailed = enforced.filter((r) => r.violations.length > 0);
  const block = opts.degradations || degradations(results, opts);
  // Per-card tag: a card carrying a degradation is never a bare `ok`.
  const tagged = new Map();
  for (const d of block) {
    const t = DEGRADATION_TYPES.find((x) => x.key === d.key);
    for (const id of d.task_ids) tagged.set(id, `${tagged.get(id) || ""}  [${t ? t.tag : d.key}]`);
  }
  const degTag = (r) => tagged.get(r.facts.task_id) || "";
  out(`QA sign-off gate — ${opts.mode} (db: ${opts.db}, epoch: ${new Date(opts.epochMs).toISOString()})`);
  out(`  enforced (done at/after epoch or pre-complete): ${enforced.length}  ·  pass: ${enforced.length - enforcedFailed.length}  ·  FAIL: ${enforcedFailed.length}`);
  out(`  bypasses & degradations (counted on every audit — never a card violation):`);
  for (const d of block) {
    if (d.available === false) {
      out(`    ${d.key.toUpperCase()} (${d.label}): not available — ${d.unavailable_reason}`);
      continue;
    }
    const cards = d.count ? `  ·  cards: ${d.task_ids.join(", ")}` : "";
    const flag = d.fail_flag && d.fail_flag_on ? `  ·  ${d.fail_flag}: ${d.fails_audit ? "FAIL" : "pass"}` : "";
    const occ = d.occurrences !== undefined ? `  ·  occurrences: ${d.occurrences}` : "";
    out(`    ${d.key.toUpperCase()} (${d.label}): ${d.count}${occ}${cards}${flag}`);
    if (d.trend) {
      const months = Object.entries(d.trend.by_month).map(([m, n]) => `${m}: ${n}`).join(", ") || "none";
      const watch = d.trend.watch_threshold_30d !== null ? `  ·  watch threshold ${d.trend.watch_threshold_30d}/30d: ${d.trend.above_watch ? "ABOVE — review these bypasses (never fails the audit)" : "below"}` : "";
      out(`        trend: last 30 days ${d.trend.last_30d} (previous 30 days ${d.trend.previous_30d}, ${d.trend.direction})${watch}  ·  by month: ${months}`);
    }
    const rows = d.cards.flatMap((c) => (c.records || []).map((x) => ({ task_id: c.task_id, ...x })));
    rows.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || a.task_id.localeCompare(b.task_id));
    for (const x of rows) out(`        ${x.task_id}  ${isoDay(x.at)}  ${x.author}  ${x.reason || "(no reason)"}  [${x.state}]`);
  }
  for (const r of failed) {
    out(`  FAIL ${fmtCard(r.facts)}${r.facts.status !== "done" ? ` [${r.facts.status}]` : ""}${degTag(r)}`);
    for (const v of r.violations) out(`        ${v.rule}: ${v.detail}`);
    for (const a of r.advisories) if (a.rule !== "A1_HISTORY_UNGATED") out(`        warn ${a.rule}: ${a.detail}`);
  }
  for (const r of enforced.filter((x) => x.violations.length === 0)) {
    out(`  ok   ${fmtCard(r.facts)}${degTag(r)}`);
    for (const a of r.advisories) if (a.rule !== "A1_HISTORY_UNGATED") out(`        warn ${a.rule}: ${a.detail}`);
  }
  if (history.length) {
    out(`  grandfathered (done before epoch — advisory only): ${history.length}`);
    for (const r of history.slice(0, 10)) {
      const notes = r.advisories.filter((a) => a.rule === "A1_HISTORY_UNGATED").map((a) => a.detail);
      out(`      warn ${r.facts.task_id}  ${notes.join("; ") || "no verdict/evidence recorded"}${degTag(r)}`);
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
  const prEpochMs = typeof args["pr-epoch-iso"] === "string" ? Date.parse(args["pr-epoch-iso"]) : Date.parse(PR_RULE_EPOCH_ISO);
  const r7v2EpochMs = typeof args["r7-v2-epoch-iso"] === "string" ? Date.parse(args["r7-v2-epoch-iso"]) : Date.parse(R7_V2_EPOCH_ISO);
  // An unparseable epoch would be NaN, and every comparison against NaN is false.
  // R7 v2 would then silently never apply to a done card. Refuse it instead.
  if (args["r7-v2-epoch-iso"] !== undefined && Number.isNaN(r7v2EpochMs)) {
    console.error("signoff-gate: --r7-v2-epoch-iso needs an ISO-8601 instant");
    process.exit(3);
  }

  if (mode === "hook") return hookMode(db);

  if (mode === "check" && !(typeof args.task === "string" && args.task)) {
    console.error("signoff-gate: `check` requires --task t_xxxxxxxx");
    process.exit(3);
  }
  if (mode !== "audit" && mode !== "check") {
    console.error(`signoff-gate: unknown mode "${mode}" (expected audit | check | hook)`);
    process.exit(3);
  }
  // Board-level flags (t_b102b100): refuse them on `check` instead of silently
  // ignoring them — a per-card check never fails on A11 (§5.9).
  for (const flag of ["fail-on-a11", "json-out", "now-iso"]) {
    if (mode === "check" && args[flag] !== undefined) {
      console.error(`signoff-gate: --${flag} applies to \`audit\` only`);
      process.exit(3);
    }
  }

  let board;
  let github;
  try {
    board = loadBoard(db);
    github = makeGitHub({ repo: resolveGitHubRepo(args["gh-repo"], repo), mode: args["no-github"] ? "off" : undefined });
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
      prEpochMs,
      r7v2EpochMs,
      github,
      preComplete: Boolean(args["pre-complete"]),
      strictHistory: Boolean(args["strict-history"]),
    });
    if (args.json) {
      return writeThenExit(`${JSON.stringify({ mode, db, repo, task_id: task.id, ...r }, null, 2)}\n`, r.violations.length ? 1 : 0);
    }
    renderReport([r], { mode: `check ${task.id}${args["pre-complete"] ? " (pre-complete)" : ""}`, db, epochMs }, (s) => console.log(s));
    process.exit(r.violations.length ? 1 : 0);
  }

  const opts = { repo, epochMs, prEpochMs, r7v2EpochMs, github, strictHistory: Boolean(args["strict-history"]) };
  // A bare switch: `--fail-on-a11 false` must not read as "on" (t_b102b100).
  if (args["fail-on-a11"] !== undefined && args["fail-on-a11"] !== true) {
    console.error(`signoff-gate: --fail-on-a11 takes no value (got "${args["fail-on-a11"]}")`);
    process.exit(3);
  }
  const failOnA11 = args["fail-on-a11"] === true;
  // --now-iso ISO (t_5b5b61e2): anchors the bypass trend's 30-day windows, so a
  // replayed audit (or the selftest) reads the trend as of a fixed instant.
  let nowMs = Date.now();
  if (args["now-iso"] !== undefined) {
    nowMs = typeof args["now-iso"] === "string" ? Date.parse(args["now-iso"]) : NaN;
    if (!Number.isFinite(nowMs)) {
      console.error(`signoff-gate: --now-iso needs an ISO-8601 instant (got "${args["now-iso"]}")`);
      process.exit(3);
    }
  }
  const results = board.tasks.filter((t) => t.status === "done").map((t) => evaluateCard(board, t, opts));
  const failures = results.filter((r) => r.violations.length > 0);
  const block = degradations(results, { failOnA11, nowMs });
  const a11 = block.find((d) => d.key === "a11");
  const bypass = (key) => {
    const d = block.find((x) => x.key === key);
    return d.available === false ? { available: false, cards: null, occurrences: null } : { available: true, cards: d.count, occurrences: d.occurrences };
  };
  // Exit 1 on violations (unchanged); also when a degradation type is allowed
  // to fail the audit and fired — today only A11 under --fail-on-a11
  // (t_b102b100). A degradation never becomes a card violation.
  const red = failures.length > 0 || block.some((d) => d.fails_audit);
  const doc = {
    mode,
    db,
    repo,
    epoch: new Date(epochMs).toISOString(),
    ok: !red,
    fail_on_a11: failOnA11,
    counts: {
      done_cards: results.length,
      enforced: results.filter((r) => r.facts.post_epoch).length,
      failures: failures.length,
      grandfathered: results.filter((r) => !r.facts.post_epoch).length,
      a11: a11.count,
      // t_5b5b61e2 — bypasses: cards + occurrences per type (null = not readable).
      exceptions: bypass("x1"),
      exceptions_withdrawn: bypass("x2"),
      completed_outside_hook: bypass("x3"),
    },
    a11_task_ids: a11.task_ids,
    degradations: block,
    results,
  };
  if (typeof args["json-out"] === "string" && args["json-out"]) {
    try {
      writeFileSync(args["json-out"], `${JSON.stringify(doc, null, 2)}\n`);
    } catch (e) {
      console.error(`signoff-gate: cannot write --json-out ${args["json-out"]}: ${e.message}`);
      process.exit(3);
    }
  } else if (args["json-out"] !== undefined) {
    console.error("signoff-gate: --json-out requires a file path");
    process.exit(3);
  }
  if (args.json) {
    return writeThenExit(`${JSON.stringify(doc, null, 2)}\n`, red ? 1 : 0);
  }
  renderReport(results, { mode, db, epochMs, failOnA11, degradations: block }, (s) => console.log(s));
  process.exit(red ? 1 : 0);
}

/**
 * Write one (possibly large) document to stdout, and exit only once it is
 * flushed (t_90a4bd73). On a pipe, a single write larger than the kernel
 * buffer (64 KiB on Linux) is only partly taken at once. The rest is queued,
 * and a `process.exit()` right after `console.log` drops it. `audit --json |
 * jq` then got exactly 65536 bytes of truncated JSON, and the selftest's
 * execFileSync read stopped at a size that depended on timing.
 */
function writeThenExit(text, code) {
  process.stdout.write(text, () => process.exit(code));
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
    const github = makeGitHub({ repo: resolveGitHubRepo(null, repo) });
    result = evaluateCard(board, task, { repo, epochMs: Date.parse(GATE_EPOCH_ISO), preComplete: true, github });
  } catch (e) {
    return block(`signoff-gate: evaluation error (${e.message}). Failing closed.`);
  }
  if (result.violations.length === 0) return allow();
  const lines = result.violations.map((v) => `  - ${v.rule}: ${v.detail}`);
  const prRules = new Set(["R9_PR_NOT_MERGED", "R10_MERGE_CI_NOT_GREEN"]);
  const qaGaps = result.violations.some((v) => !prRules.has(v.rule));
  const prGaps = result.violations.some((v) => prRules.has(v.rule));
  return block(
    [
      `QA sign-off gate blocked this completion of ${taskId} (${result.violations.length} violation(s)):`,
      ...lines,
      ...(qaGaps
        ? [
            "Record the verdict on the card, then call kanban_complete again:",
            `  hermes kanban comment ${taskId} --author qa --body "QA-VERDICT: pass — evidence: tests/evidence/${taskId}/README.md"`,
          ]
        : []),
      ...(prGaps
        ? [
            "A code card completes only after its PR is merged into master with green CI on the merge commit (§5.9):",
            '  the author moves the card to review with "PR: #<n>" (kanban_request_review); the merger completes it after the merge.',
          ]
        : []),
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
