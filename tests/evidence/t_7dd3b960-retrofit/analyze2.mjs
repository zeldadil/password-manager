import fs from "node:fs";
// Usage: node analyze2.mjs <audit.json> [card ids...]
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ids = process.argv.slice(3);
const R = a.results.map((r) => ({ ...r.facts, violations: r.violations, advisories: r.advisories }));
const isFail = (r) => r.violations.length > 0;
const pre = R.filter((r) => !r.post_epoch);
const post = R.filter((r) => r.post_epoch);
console.log(`file ${process.argv[2]}  counts=${JSON.stringify(a.counts)}`);
console.log(`pre-epoch FAIL: ${pre.filter(isFail).length} / ${pre.length}`);
console.log(`post-epoch FAIL: ${post.filter(isFail).length} / ${post.length}`);
console.log("-- pre-epoch FAIL ids --");
for (const r of pre.filter(isFail)) {
  console.log(`  ${r.task_id}  ${r.violations.map((v) => v.rule).join(",")}  post_epoch=${r.post_epoch}`);
}
if (ids.length) {
  console.log("-- cards of interest --");
  for (const id of ids) {
    const r = R.find((x) => x.task_id === id);
    if (!r) { console.log(`  ${id}: NOT FOUND`); continue; }
    console.log(`  ${id} post_epoch=${r.post_epoch} status=${r.status} verdict=${JSON.stringify(r.verdict)} deferral=${JSON.stringify(r.deferral)} evidence=${JSON.stringify(r.evidence)} security_track=${r.security_track}`);
    for (const v of r.violations) console.log(`      FAIL ${v.rule}: ${String(v.detail).slice(0, 220)}`);
    for (const v of r.advisories) console.log(`      warn ${v.rule}: ${String(v.detail).slice(0, 220)}`);
  }
}
