// Compare two `signoff-gate.mjs audit --json` outputs (before = master, after =
// this branch) on the §5.9 facts of every card: linked PRs, judged PR, R9/R10.
// Usage: node audit-diff.mjs before.json after.json
import { readFileSync } from "node:fs";
const load = (f) => JSON.parse(readFileSync(f, "utf8"));
const [b, a] = [load(process.argv[2]), load(process.argv[3])];
const index = (j) => new Map(j.results.map((r) => [r.facts.task_id, r]));
const [B, A] = [index(b), index(a)];
const sum = (r) => {
  const pr = (r && r.facts.pr_rule) || {};
  const rules = (r ? r.violations : []).map((v) => v.rule).filter((x) => /^R(9|10)_/.test(x));
  return {
    in_scope: pr.in_scope ?? null,
    applies: pr.applies ?? null,
    linked: (pr.linked_prs || []).map((p) => p.number).sort((x, y) => x - y),
    judged: pr.judged_pr ?? null,
    r910: rules,
    mentions: (pr.mentioning_prs || []).map((p) => p.number).sort((x, y) => x - y),
  };
};
let inScope = 0;
let changed = 0;
const lines = [];
for (const id of [...new Set([...B.keys(), ...A.keys()])].sort()) {
  const sb = sum(B.get(id));
  const sa = sum(A.get(id));
  if (!sb.in_scope && !sa.in_scope) continue;
  inScope++;
  const same = JSON.stringify([sb.applies, sb.linked, sb.judged, sb.r910]) === JSON.stringify([sa.applies, sa.linked, sa.judged, sa.r910]);
  if (!same) changed++;
  lines.push(
    `${same ? "same   " : "CHANGED"} ${id}  before: applies=${sb.applies} linked=[${sb.linked}] judged=${sb.judged} R9/R10=[${sb.r910}]  →  after: applies=${sa.applies} linked=[${sa.linked}] judged=${sa.judged} R9/R10=[${sa.r910}] A14=[${sa.mentions}]`,
  );
}
console.log(`cards judged by §5.9 (in_scope) in either run: ${inScope}; outcome changed: ${changed}`);
// Non-§5.9 control: every other violation of every card must be identical.
const allRules = (r) => (r ? r.violations.map((v) => v.rule).sort().join(",") : "");
const otherDiff = [...new Set([...B.keys(), ...A.keys()])].filter((id) => allRules(B.get(id)) !== allRules(A.get(id)));
const failing = (M) => [...M.values()].filter((r) => r.violations.length).length;
console.log(`cards audited — before: ${B.size}, after: ${A.size}; cards with ≥1 violation — before: ${failing(B)}, after: ${failing(A)}`);
console.log(`cards whose violation set differs between the runs (any rule): ${otherDiff.length ? otherDiff.join(", ") : "none"}`);
console.log(`audit exit summary — before: ${JSON.stringify(b.summary ?? null)}`);
console.log(`audit exit summary — after:  ${JSON.stringify(a.summary ?? null)}`);
for (const l of lines) console.log(l);
