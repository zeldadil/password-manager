#!/usr/bin/env node
// t_5b5b61e2 — compare two `audit --json` documents of the SAME board snapshot:
// master gate (A) vs branch gate (B). Prints, per change class, the cards whose
// violation set or advisory set differs, and the advisory rules added/removed.
// Expected for this card: 0 violation-set changes; advisory changes limited to
// the NEW rule X3_COMPLETED_OUTSIDE_HOOK (added) — no other rule appears,
// disappears or changes its detail text.
// Usage: node ab-compare.mjs A.json B.json "<label>"
import { readFileSync } from "node:fs";

const [a, b] = [process.argv[2], process.argv[3]].map((p) => JSON.parse(readFileSync(p, "utf8")));
const label = process.argv[4] || "";
const byId = (doc) => new Map(doc.results.map((r) => [r.facts.task_id, r]));
const A = byId(a);
const B = byId(b);
const key = (x) => `${x.rule}\u0000${x.detail}`;
let violChanged = 0;
const advAdded = {};
const advRemoved = {};
const cardsAdv = new Set();
for (const [id, ra] of A) {
  const rb = B.get(id);
  if (!rb) {
    console.log(`  card ${id} missing from B`);
    violChanged++;
    continue;
  }
  const va = ra.violations.map(key).sort().join("\n");
  const vb = rb.violations.map(key).sort().join("\n");
  if (va !== vb) {
    violChanged++;
    console.log(`  VIOLATION SET CHANGED ${id}`);
  }
  const sa = new Set(ra.advisories.map(key));
  const sb = new Set(rb.advisories.map(key));
  for (const x of sb) if (!sa.has(x)) {
    const r = x.split("\u0000")[0];
    advAdded[r] = (advAdded[r] || 0) + 1;
    cardsAdv.add(id);
  }
  for (const x of sa) if (!sb.has(x)) {
    const r = x.split("\u0000")[0];
    advRemoved[r] = (advRemoved[r] || 0) + 1;
    cardsAdv.add(id);
  }
}
if (B.size !== A.size) console.log(`  card count differs: A=${A.size} B=${B.size}`);
console.log(`[${label}] done cards=${A.size}  violation-set changes=${violChanged}  cards with advisory changes=${cardsAdv.size}`);
console.log(`  advisories added by B: ${JSON.stringify(advAdded)}`);
console.log(`  advisories removed by B: ${JSON.stringify(advRemoved)}`);
console.log(`  counts A=${JSON.stringify({ failures: a.counts.failures, a11: a.counts.a11 })}  B=${JSON.stringify(b.counts)}`);
const onlyX3 = Object.keys(advAdded).every((r) => r === "X3_COMPLETED_OUTSIDE_HOOK") && Object.keys(advRemoved).length === 0;
console.log(`  verdict: ${violChanged === 0 && onlyX3 ? "OK — no violation-set change; the only advisory change is the new X3" : "UNEXPECTED DELTA"}`);
