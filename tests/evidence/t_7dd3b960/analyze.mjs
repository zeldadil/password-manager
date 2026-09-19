import fs from "node:fs";

const dir = process.env.EVIDENCE_DIR || "/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence";
const strict = JSON.parse(fs.readFileSync(`${dir}/audit-strict-history.json`, "utf8"));
const def = JSON.parse(fs.readFileSync(`${dir}/audit-default.json`, "utf8"));

const id = (r) => r.facts.task_id;
const vios = (r) => r.violations.map((v) => v.rule);

console.log("counts strict:", JSON.stringify(strict.counts));
console.log("counts default:", JSON.stringify(def.counts));
console.log();

console.log("=== ENFORCED (post-epoch) view — default audit ===");
for (const r of def.results.filter((x) => x.violations.length)) {
  console.log(`FAIL ${id(r)} ${r.facts.assignee} :: ${vios(r).join(",")}`);
  for (const v of r.violations) console.log(`      - ${v.rule}: ${v.detail}`);
}

console.log();
console.log("=== STRICT-HISTORY failures (all) ===");
for (const r of strict.results.filter((x) => x.violations.length)) {
  console.log(`FAIL ${id(r)} post_epoch=${r.facts.post_epoch} ${r.facts.assignee} :: ${vios(r).join(",")}`);
  for (const v of r.violations) console.log(`      - ${v.rule}: ${v.detail}`);
}

console.log();
console.log("=== GRANDFATHERED backlog (pre-epoch done cards) ===");
const pre = strict.results.filter((r) => !r.facts.post_epoch);
console.log("count =", pre.length);
for (const r of pre) {
  const f = r.facts;
  const gaps = r.advisories.filter((a) => a.rule === "A1_HISTORY_UNGATED").map((a) => a.detail);
  const hasV = f.verdict !== null && f.verdict !== undefined && !(f.invalid_verdicts || []).length;
  const hasE = (f.evidence || []).length > 0;
  console.log(
    `${f.task_id}\t${hasV ? "V" : "-"}${hasE ? "E" : "-"}\tsec=${f.security_track ? "Y" : "n"}\t${String(f.assignee).padEnd(10)}\t${new Date(f.completed_at * 1000).toISOString().slice(0, 16)}\t${String(f.title).slice(0, 82)}`,
  );
}

console.log();
console.log("=== post-epoch done cards: OK / FAIL detail ===");
for (const r of strict.results.filter((x) => x.facts.post_epoch)) {
  console.log(`${vios(r).length ? "FAIL" : "ok  "} ${id(r)} sec=${r.facts.security_track ? "Y" : "n"} ${r.facts.assignee} :: ${r.facts.title.slice(0, 70)}`);
}

console.log();
console.log("=== R7-relevant: security_track=true cards ===");
for (const r of strict.results.filter((x) => x.facts.security_track)) {
  console.log(`${id(r)}\tpost_epoch=${r.facts.post_epoch}\t${r.facts.assignee}\t${r.facts.title.slice(0, 80)}`);
}
