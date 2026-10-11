// t_f4daddb9 — compare two `signoff-gate.mjs audit --json` outputs (before =
// reference gate, after = this branch) card by card.
// Prints: every card whose FULL violation set differs (the card's acceptance
// criterion 3), then every card whose §5.9 facts differ (applies / linked /
// judged / R9-R10 / unmerged mentions), then the totals.
// Usage: node audit-diff.mjs before.json after.json
import { readFileSync } from "node:fs";
const load = (f) => JSON.parse(readFileSync(f, "utf8"));
const [b, a] = [load(process.argv[2]), load(process.argv[3])];
const index = (j) => new Map(j.results.map((r) => [r.facts.task_id, r]));
const [B, A] = [index(b), index(a)];
const ids = [...new Set([...B.keys(), ...A.keys()])].sort();
const rules = (r) => (r ? r.violations.map((v) => v.rule).sort() : []);
const pr = (r) => (r && r.facts.pr_rule) || {};
const nums = (xs) => (xs || []).map((p) => (typeof p === "number" ? p : p.number)).sort((x, y) => x - y);
const mentionsWithState = (r) => (pr(r).mentioning_prs || []).map((p) => `#${p.number}:${p.merged ? "merged" : (p.state || "?").toLowerCase()}`).join(" ");
const s59 = (r) => {
  const p = pr(r);
  return {
    in_scope: p.in_scope ?? null,
    applies: p.applies ?? null,
    linked: nums(p.linked_prs),
    judged: p.judged_pr ?? null,
    r910: rules(r).filter((x) => /^R(9|10)_/.test(x)),
    unmerged_mentions: nums(p.unmerged_mentioning_prs),
  };
};

const violationChanged = ids.filter((id) => JSON.stringify(rules(B.get(id))) !== JSON.stringify(rules(A.get(id))));
const factsChanged = ids.filter((id) => {
  const [x, y] = [s59(B.get(id)), s59(A.get(id))];
  return JSON.stringify([x.applies, x.linked, x.judged, x.r910]) !== JSON.stringify([y.applies, y.linked, y.judged, y.r910]);
});
const failing = (M) => [...M.values()].filter((r) => r.violations.length).length;
const anyMention = ids.filter((id) => (pr(A.get(id)).mentioning_prs || []).length);
const unmergedMention = ids.filter((id) => s59(A.get(id)).unmerged_mentions.length);

console.log(`cards audited — before: ${B.size}, after: ${A.size}; cards with >=1 violation — before: ${failing(B)}, after: ${failing(A)}`);
console.log(`cards with any A14 mention (after): ${anyMention.length}; of which with an UNMERGED mentioning PR: ${unmergedMention.length}`);
console.log(`cards whose violation set changes (any rule): ${violationChanged.length}${violationChanged.length ? " — " + violationChanged.join(", ") : ""}`);
for (const id of violationChanged) {
  const r = A.get(id) || B.get(id);
  console.log(`  ${id} [${r.facts.status ?? "?"}] before=[${rules(B.get(id))}] after=[${rules(A.get(id))}] mentions: ${mentionsWithState(A.get(id)) || "-"}`);
  const det = (A.get(id)?.violations || []).find((v) => v.rule === "R9_PR_NOT_MERGED");
  if (det) console.log(`    R9 detail: ${det.detail.slice(0, 400)}`);
}
console.log(`cards whose §5.9 outcome (applies/linked/judged/R9-R10) changes: ${factsChanged.length}`);
for (const id of factsChanged) {
  const [x, y] = [s59(B.get(id)), s59(A.get(id))];
  console.log(`  ${id} before: applies=${x.applies} linked=[${x.linked}] judged=${x.judged} R9/R10=[${x.r910}]  ->  after: applies=${y.applies} linked=[${y.linked}] judged=${y.judged} R9/R10=[${y.r910}] unmerged-mentions=[${y.unmerged_mentions}] (in_scope=${y.in_scope})`);
}
console.log("cards with an unmerged mentioning PR (after), whatever the outcome:");
for (const id of unmergedMention) {
  const y = s59(A.get(id));
  console.log(`  ${id} in_scope=${y.in_scope} applies=${y.applies} linked=[${y.linked}] R9/R10=[${y.r910}] mentions: ${mentionsWithState(A.get(id))}`);
}
console.log(`audit summary — before: ${JSON.stringify(b.summary ?? b.counts ?? null)}`);
console.log(`audit summary — after:  ${JSON.stringify(a.summary ?? a.counts ?? null)}`);
