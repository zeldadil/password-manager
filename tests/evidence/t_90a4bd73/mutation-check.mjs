#!/usr/bin/env node
/**
 * t_90a4bd73 — non-vacuity proof for the R7 scope-v2 selftest cases.
 *
 * Copies scripts/qa/ into a temp dir and applies ONE mutation to the gate per
 * run. Each mutation removes or reverts one part of this change. The selftest
 * then runs against that mutant. A case is non-vacuous only if it is `ok` on
 * the real gate (M0) and `FAIL` on the mutant that removes what it guards.
 *
 *   M0  none (control)                                   → every case ok
 *   M1  v1 classification restored (\b(...)\b list AND `security` Test Type)
 *                                                        → (a) (b) (c1) (d) (e) (e2) (g) (i) (j) FAIL
 *   M2  option B (token OR `security` Test Type)         → (c2) (k) FAIL
 *   M3  ¬qa exemption dropped                            → (f) FAIL
 *   M4  writeThenExit reverted (exit without flush)      → slow-pipe case FAIL
 *   M5  R7 v2 epoch removed (v2 enforced retroactively)  → (g) FAIL
 *   M6  v1 obligation not kept before the epoch          → (h) FAIL
 *   M7  bare `nonce` / `vault key` tokens (no word guard) → (k) FAIL
 *   M8  NaN guard on --r7-v2-epoch-iso removed           → unparseable-epoch case FAIL
 *
 * Usage (repo root): node tests/evidence/t_90a4bd73/mutation-check.mjs
 * Exit 0 = every expectation met.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SRC = resolve("scripts/qa");
const GATE_FILE = "signoff-gate.mjs";

const V2_BODY = `  return (
    SECURITY_TRACK_RE.test(\`\${task.title || ""}\\n\${task.body || ""}\`) &&
    !QA_PROFILES.has(String(task.assignee || "").trim())
  );`;
const V1_BODY = `  return (
    /\\b(packages\\/crypto|crypto[\\s-]*(primitive|implementation|boundary|module|package)|KDF|AEAD|Argon2id|vault[\\s-]*key|bridge[\\s-]*protocol|bridge[\\s-]*message|autofill)\\b/i.test(\`\${task.title || ""}\\n\${task.body || ""}\`) &&
    /security/.test(testTypesOf(task)) &&
    !QA_PROFILES.has(String(task.assignee || "").trim())
  );`;
const B_BODY = `  return (
    (SECURITY_TRACK_RE.test(\`\${task.title || ""}\\n\${task.body || ""}\`) || /security/.test(testTypesOf(task))) &&
    !QA_PROFILES.has(String(task.assignee || "").trim())
  );`;
const NOQA_BODY = `  return SECURITY_TRACK_RE.test(\`\${task.title || ""}\\n\${task.body || ""}\`);`;
const ENFORCED = "  const securityTrackEnforced = (securityTrack && r7v2InForce) || isSecurityTrackV1(task);";

const LABELS = ["R7v2 (a)", "R7v2 (b)", "R7v2 (c1)", "R7v2 (c2)", "R7v2 (d)", "R7v2 (e)", "R7v2 (e2)", "R7v2 (f)", "R7v2 (k)", "R7v2 (g)", "R7v2 (h)", "R7v2 (i)", "R7v2 (j)", "--r7-v2-epoch-iso with an unparseable", "audit --json through a slow pipe"];
const PIPE = LABELS.at(-1);
const NAN = LABELS.at(-2);

const mutants = [
  { id: "M0", what: "none (control)", edits: [], mustFail: [] },
  { id: "M1", what: "v1 classification restored", edits: [[V2_BODY, V1_BODY]], mustFail: ["R7v2 (a)", "R7v2 (b)", "R7v2 (c1)", "R7v2 (d)", "R7v2 (e)", "R7v2 (e2)", "R7v2 (g)", "R7v2 (i)", "R7v2 (j)"] },
  { id: "M2", what: "option B (token OR security Test Type)", edits: [[V2_BODY, B_BODY]], mustFail: ["R7v2 (c2)", "R7v2 (k)"] },
  { id: "M3", what: "¬qa exemption dropped", edits: [[V2_BODY, NOQA_BODY]], mustFail: ["R7v2 (f)"] },
  {
    id: "M4",
    what: "writeThenExit reverted (exit without flush)",
    edits: [["  process.stdout.write(text, () => process.exit(code));", '  console.log(text.replace(/\\n$/, ""));\n  process.exit(code);']],
    mustFail: [PIPE],
  },
  { id: "M5", what: "R7 v2 epoch removed (retroactive)", edits: [[ENFORCED, "  const securityTrackEnforced = securityTrack;"]], mustFail: ["R7v2 (g)"] },
  { id: "M6", what: "v1 obligation not kept before the epoch", edits: [[ENFORCED, "  const securityTrackEnforced = securityTrack && r7v2InForce;"]], mustFail: ["R7v2 (h)"] },
  {
    id: "M7",
    what: "bare `nonce` / `vault key` tokens",
    edits: [
      ["String.raw`(?<![\\p{L}\\p{N}])nonce`", "String.raw`nonce`"],
      ["String.raw`vault[\\s_-]*key(?!board)`", "String.raw`vault[\\s_-]*key`"],
    ],
    mustFail: ["R7v2 (k)"],
  },
  {
    id: "M8",
    what: "NaN guard on --r7-v2-epoch-iso removed",
    edits: [['if (args["r7-v2-epoch-iso"] !== undefined && Number.isNaN(r7v2EpochMs)) {', "if (false) {"]],
    mustFail: [NAN],
  },
];

const gateSrc = readFileSync(join(SRC, GATE_FILE), "utf8");
let allOk = true;
for (const m of mutants) {
  let src = gateSrc;
  let anchored = true;
  for (const [from, to] of m.edits) {
    if (!src.includes(from)) anchored = false;
    src = src.replace(from, to);
  }
  if (!anchored) {
    console.log(`${m.id}  mutation: ${m.what}  ·  ANCHOR NOT FOUND in ${GATE_FILE} — not run`);
    allOk = false;
    continue;
  }
  const dir = mkdtempSync(join(tmpdir(), `r7v2-${m.id}-`));
  cpSync(SRC, join(dir, "qa"), { recursive: true });
  writeFileSync(join(dir, "qa", GATE_FILE), src);
  let out = "";
  try {
    out = execFileSync("node", [join(dir, "qa", "signoff-gate.selftest.mjs")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  } catch (e) {
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  rmSync(dir, { recursive: true, force: true });
  const lines = out.split("\n");
  const status = (label) => {
    // Exactly one result line per label — an ambiguous label would let one case
    // stand in for another (it happened: "(a)" first matched a t_338f47fd case).
    const hits = lines.filter((l) => (l.startsWith("  ok   - ") || l.startsWith("  FAIL - ")) && l.slice(9).startsWith(label));
    if (hits.length > 1) return "ambiguous";
    return hits.length ? (hits[0].startsWith("  ok") ? "ok" : "FAIL") : "missing";
  };
  const total = (out.match(/^\d+\/\d+ cases passed$/m) || out.match(/^.*\d+ of \d+.*$/m) || out.match(/^.*FAILED.*$/m) || ["(no total line)"])[0];
  console.log(`${m.id}  mutation: ${m.what}  ·  selftest: ${total.trim()}`);
  for (const label of LABELS) {
    const s = status(label);
    const expected = m.mustFail.includes(label) ? "FAIL" : "ok";
    const met = s === expected;
    if (!met) allOk = false;
    console.log(`    ${label.slice(0, 34).padEnd(34)} ${s.padEnd(7)} expected ${expected.padEnd(5)} ${met ? "✓" : "✗ UNMET"}`);
  }
}
console.log(allOk ? "\nRESULT: every expectation met — each new case fails on the mutant that removes what it guards." : "\nRESULT: at least one expectation UNMET.");
process.exit(allOk ? 0 : 1);
