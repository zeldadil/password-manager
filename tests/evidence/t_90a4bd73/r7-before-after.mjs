#!/usr/bin/env node
/**
 * t_90a4bd73 — R7 before/after tables (classification over every card, and the
 * `audit --strict-history` outcome over every audited card).
 *
 * Inputs (no raw board content is committed — public repo, see t_7dd3b960):
 *   --db <board.db>          the board snapshot both audits ran on
 *   --before <audit.json>    `audit --strict-history --json` of the gate at the base commit (v1)
 *   --after  <audit.json>    the same command with this branch's gate (scope-v2)
 *
 * Output: markdown on stdout. Only ids, status, assignee, titles, and the
 * NAMES of the scope-v2 boundary tokens that matched are printed. The tokens
 * are matched one by one against SCOPE_V2_TOKENS. Card bodies are never printed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const gate = await import(pathToFileURL(resolve("scripts/qa/signoff-gate.mjs")).href);
const { loadBoard, testTypesOf, isSecurityTrack, SCOPE_V2_TOKENS, GATE_EPOCH_ISO } = gate;

// v1 exactly as shipped on master @ 626feb7 (scripts/qa/signoff-gate.mjs:203-204, 1443-1447).
const V1_RE =
  /\b(packages\/crypto|crypto[\s-]*(primitive|implementation|boundary|module|package)|KDF|AEAD|Argon2id|vault[\s-]*key|bridge[\s-]*protocol|bridge[\s-]*message|autofill)\b/i;
const blob = (t) => `${t.title || ""}\n${t.body || ""}`;
const isQa = (t) => String(t.assignee || "").trim() === "qa";
const v1 = (t) => V1_RE.test(blob(t)) && /security/.test(testTypesOf(t)) && !isQa(t);
const v2 = (t) => isSecurityTrack(t);
const tokensHit = (t) => SCOPE_V2_TOKENS.filter((tok) => new RegExp(tok, "iu").test(blob(t)));
const md = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const board = loadBoard(args.db);
const epochMs = Date.parse(GATE_EPOCH_ISO);
const tasks = [...board.tasks].sort((a, b) => a.id.localeCompare(b.id));
const preEpochDone = (t) => t.status === "done" && t.completed_at && Number(t.completed_at) * 1000 < epochMs;
const why = (t) => {
  if (v1(t)) return "both";
  if (!V1_RE.test(blob(t))) return "v1 keyword miss";
  if (!/security/.test(testTypesOf(t))) return "v1 Test-Type AND";
  return "?";
};

const out = [];
const p = (s = "") => out.push(s);
const v1Set = tasks.filter(v1);
const v2Set = tasks.filter(v2);
p(`## 1. Classification over every card (${tasks.length} cards on the snapshot)`);
p();
p(`| | v1 (master @ 626feb7) | v2 (scope-v2, this branch) |`);
p(`|---|---|---|`);
p(`| security-track cards | ${v1Set.length} | ${v2Set.length} |`);
p(`| … of which \`done\` | ${v1Set.filter((t) => t.status === "done").length} | ${v2Set.filter((t) => t.status === "done").length} |`);
p(`| … of which \`done\` before the gate epoch (grandfathered → advisory) | ${v1Set.filter(preEpochDone).length} | ${v2Set.filter(preEpochDone).length} |`);
p(`| dropped by v2 (flagged by v1, not by v2) | — | ${v1Set.filter((t) => !v2(t)).length} |`);
p();
p(`### 1.1 Every card v2 classifies as security-track`);
p();
p(`| card | status | assignee | pre-epoch done | v1 | v1 miss reason | scope-v2 tokens matched | title |`);
p(`|---|---|---|---|---|---|---|---|`);
for (const t of v2Set) {
  p(`| \`${t.id}\` | ${t.status} | ${t.assignee || ""} | ${preEpochDone(t) ? "yes" : ""} | ${v1(t) ? "YES" : "no"} | ${v1(t) ? "" : why(t)} | ${tokensHit(t).map((x) => `\`${md(x)}\``).join(" ")} | ${md(t.title).slice(0, 80)} |`);
}
p();
const qaHits = tasks.filter((t) => isQa(t) && tokensHit(t).length);
p(`### 1.2 Exempt by ¬qa (scope token present, assignee \`qa\`): ${qaHits.length} cards`);
p();
p(qaHits.map((t) => `\`${t.id}\``).join(" ") || "none");
p();

if (args.before && args.after) {
  const before = JSON.parse(readFileSync(args.before, "utf8"));
  const after = JSON.parse(readFileSync(args.after, "utf8"));
  const idx = (doc) => new Map(doc.results.map((r) => [r.facts.task_id, r]));
  const B = idx(before);
  const A = idx(after);
  const ids = [...new Set([...B.keys(), ...A.keys()])].sort();
  const failed = (r) => r && r.violations.length > 0;
  const r7 = (r) => !!r && r.violations.some((v) => v.rule === "R7_SECURITY_TRACK_SIGNOFF_MISSING");
  const st = (r) => !!r && r.facts.security_track === true;
  const a17 = (r) => !!r && r.advisories.some((v) => v.rule === "A17_R7_SCOPE_V2_UNGATED");
  p(`## 2. \`audit --strict-history\` before / after (same snapshot, same command)`);
  p();
  p(`| | before (v1) | after (scope-v2) |`);
  p(`|---|---|---|`);
  p(`| audited cards | ${B.size} | ${A.size} |`);
  p(`| FAIL | ${[...B.values()].filter(failed).length} | ${[...A.values()].filter(failed).length} |`);
  p(`| audited cards classified security-track | ${[...B.values()].filter(st).length} | ${[...A.values()].filter(st).length} |`);
  p(`| R7 violations | ${[...B.values()].filter(r7).length} | ${[...A.values()].filter(r7).length} |`);
  p(`| A17 advisories (scope-v2, completed before the R7 v2 epoch, no Architect sign-off) | ${[...B.values()].filter(a17).length} | ${[...A.values()].filter(a17).length} |`);
  p();
  const changed = ids.filter((id) => {
    const b = B.get(id);
    const a = A.get(id);
    const rules = (r) => (r ? r.violations.map((v) => v.rule).sort().join(",") : "");
    return st(b) !== st(a) || rules(b) !== rules(a);
  });
  p(`### 2.1 Cards whose classification or violations changed: ${changed.length}`);
  p();
  p(`| card | status | security-track before → after | violations before | violations after | A17 advisory after |`);
  p(`|---|---|---|---|---|---|`);
  for (const id of changed) {
    const b = B.get(id);
    const a = A.get(id);
    const t = board.taskById.get(id) || {};
    const rules = (r) => (r ? r.violations.map((v) => v.rule.split("_")[0]).join(", ") || "—" : "n/a");
    p(`| \`${id}\` | ${t.status || ""} | ${st(b)} → ${st(a)} | ${rules(b)} | ${rules(a)} | ${a17(a) ? "yes" : ""} |`);
  }
  p();
}
console.log(out.join("\n"));
