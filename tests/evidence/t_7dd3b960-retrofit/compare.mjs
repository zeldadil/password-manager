import fs from "node:fs";
// before/after comparison: exact set difference, plus the post-epoch view.
const load = (p) => {
  const a = JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    counts: a.counts,
    fails: new Set(a.results.filter((r) => r.violations.length > 0).map((r) => r.facts.task_id)),
    pre: new Set(a.results.filter((r) => !r.facts.post_epoch).map((r) => r.facts.task_id)),
    preFails: new Set(a.results.filter((r) => !r.facts.post_epoch && r.violations.length > 0).map((r) => r.facts.task_id)),
    postFails: new Set(a.results.filter((r) => r.facts.post_epoch && r.violations.length > 0).map((r) => r.facts.task_id)),
    all: new Set(a.results.map((r) => r.facts.task_id)),
  };
};
const b = load(process.argv[2]);
const a = load(process.argv[3]);
console.log(`before counts: ${JSON.stringify(b.counts)}`);
console.log(`after  counts: ${JSON.stringify(a.counts)}`);
console.log(`pre-epoch FAIL: ${b.preFails.size} -> ${a.preFails.size}`);
console.log(`post-epoch FAIL: ${b.postFails.size} -> ${a.postFails.size}`);
const cleared = [...b.preFails].filter((x) => !a.preFails.has(x)).sort();
const newly = [...a.preFails].filter((x) => !b.preFails.has(x)).sort();
console.log(`cleared pre-epoch FAILs (${cleared.length}): ${cleared.join(", ")}`);
console.log(`NEWLY failing pre-epoch cards (${newly.length}): ${newly.join(", ") || "NONE"}`);
console.log(`subset check: after-pre-epoch-fails ⊆ before-pre-epoch-fails -> ${[...a.preFails].every((x) => b.preFails.has(x))}`);
const newCards = [...a.all].filter((x) => !b.all.has(x));
const goneCards = [...b.all].filter((x) => !a.all.has(x));
console.log(`cards new to the done-audit: ${newCards.join(", ") || "none"}`);
console.log(`cards gone from the done-audit: ${goneCards.join(", ") || "none"}`);
const newDone = [...a.all].filter((x) => !b.all.has(x)).filter((x) => !a.fails.has(x));
console.log(`new done cards that PASS: ${newDone.join(", ") || "none"}`);
console.log(`post-epoch FAILs unchanged: ${[...a.postFails].sort().join(",") === [...b.postFails].sort().join(",")}`);
console.log(`post-epoch FAIL set: ${[...a.postFails].sort().join(", ")}`);
