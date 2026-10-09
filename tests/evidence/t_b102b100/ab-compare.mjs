// t_b102b100 — compare two `signoff-gate.mjs audit --json` documents card by card.
// Usage: node ab-compare.mjs master.json branch.json "<label>"
import { readFileSync } from "node:fs";

const [ma, br, label] = process.argv.slice(2);
const A = JSON.parse(readFileSync(ma, "utf8"));
const B = JSON.parse(readFileSync(br, "utf8"));
const key = (r) => JSON.stringify({ v: r.violations.map((x) => x.rule).sort(), a: r.advisories.map((x) => x.rule).sort() });
const mapA = new Map(A.results.map((r) => [r.facts.task_id, key(r)]));
const mapB = new Map(B.results.map((r) => [r.facts.task_id, key(r)]));
const changed = [...new Set([...mapA.keys(), ...mapB.keys()])].filter((id) => mapA.get(id) !== mapB.get(id));
const a11FromResults = B.results.filter((r) => r.advisories.some((x) => x.rule === "A11_CI_STATE_UNVERIFIABLE")).map((r) => r.facts.task_id);
console.log(`== ${label}`);
console.log(`  cards master=${mapA.size} branch=${mapB.size}  rule-set changes=${changed.length}${changed.length ? ` (${changed.join(", ")})` : ""}`);
console.log(`  counts master=${JSON.stringify(A.counts)}`);
console.log(`  counts branch=${JSON.stringify(B.counts)}`);
console.log(`  branch a11_task_ids=${JSON.stringify(B.a11_task_ids)}  matches results=${JSON.stringify(a11FromResults) === JSON.stringify(B.a11_task_ids)}`);
