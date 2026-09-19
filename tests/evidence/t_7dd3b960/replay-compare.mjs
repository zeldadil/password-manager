import fs from "node:fs";
const EV = process.env.EVIDENCE_DIR || "/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence";
const load = (p) => JSON.parse(fs.readFileSync(`${EV}/${p}`, "utf8"));
const A = load(process.env.A_FILE || "audit-default.json"); // full checkout (identical run to the default audit)
const B = load("job-B-shallow-clone.json");

console.log("A full checkout (all refs)   :", JSON.stringify(A.counts));
console.log("B shallow checkout (depth 1) :", JSON.stringify(B.counts));
console.log("repo used A:", A.repo);
console.log("repo used B:", B.repo);
console.log();

const rules = (r) => r.violations.map((v) => v.rule).sort().join("+") || "ok";
const mb = new Map(B.results.map((r) => [r.facts.task_id, r]));
console.log("=== cards whose outcome differs (shallow vs full) ===");
for (const r of A.results) {
  const id = r.facts.task_id;
  const o = mb.get(id);
  if (!o) continue;
  if (rules(r) !== rules(o)) {
    console.log(`${id}  full=${rules(r)}   shallow=${rules(o)}   :: ${r.facts.title.slice(0, 60)}`);
    for (const v of o.violations) if (v.rule === "R5_EVIDENCE_FILE_MISSING") console.log(`      shallow-only R5: ${v.detail}`);
  }
}
console.log();
console.log("A failing cards:", A.results.filter((r) => r.violations.length).map((r) => r.facts.task_id).join(", "));
console.log("B failing cards:", B.results.filter((r) => r.violations.length).map((r) => r.facts.task_id).join(", "));
