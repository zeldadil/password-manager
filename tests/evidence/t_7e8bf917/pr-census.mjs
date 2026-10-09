// t_7e8bf917 — impact census over every PR of the repo (read-only, from a
// `gh pr list --state all --json number,title,body,headRefName,state` dump):
// which PRs carry a card id in their TITLE (the author's intended card) yet do
// NOT declare it under the new §5.9 vocabulary? Those are the cases where the
// change turns a former link into an A14 mention.
// Usage: node tests/evidence/t_7e8bf917/pr-census.mjs <prs.json>
import { readFileSync } from "node:fs";
import { prCardRelation } from "../../../scripts/qa/signoff-gate.mjs";

const prs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const idRe = /t_[0-9a-f]{8}/g;
let titled = 0;
const lost = [];
const bodyHeadingForm = [];
for (const pr of prs.sort((a, b) => a.number - b.number)) {
  const ids = new Set((pr.title || "").match(idRe) || []);
  for (const id of ids) {
    titled++;
    const rel = prCardRelation(pr, id);
    if (rel && rel.link) continue;
    lost.push(`#${pr.number} ${pr.state} ${id} head=${pr.headRefName} → ${rel ? "A14 (" + rel.mention.join("+") + ")" : "none"}`);
    if (/##\s*Task\s*(\\n|\n)\s*t_/i.test(pr.body || "")) bodyHeadingForm.push(pr.number);
  }
}
console.log(`PR×card pairs with the id in the PR title: ${titled}`);
console.log(`of which NOT linked under the declarative rule: ${lost.length}`);
for (const l of lost) console.log("  " + l);
console.log(`of those, body uses a "## Task" heading + id on the next line: ${bodyHeadingForm.map((n) => "#" + n).join(", ") || "none"}`);
