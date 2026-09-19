import fs from "node:fs";

const EV = process.env.EVIDENCE_DIR || "/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence";
const load = (p) => JSON.parse(fs.readFileSync(`${EV}/${p}`, "utf8"));
const a = load("audit-default.json"); // PR25 gate (installed)
const b = load("audit-master-gate.json"); // master gate (what CI checks out today)

const key = (r) => r.facts.task_id;
const rules = (r) => r.violations.map((v) => v.rule).sort().join("+") || "ok";

console.log("PR25 gate : counts =", JSON.stringify(a.counts));
console.log("master gate: counts =", JSON.stringify(b.counts));
console.log();

const ma = new Map(a.results.map((r) => [key(r), r]));
const mb = new Map(b.results.map((r) => [key(r), r]));

const diffs = [];
for (const [id, r] of ma) {
  const other = mb.get(id);
  const ra = rules(r);
  const rb = other ? rules(other) : "(missing)";
  if (ra !== rb) diffs.push({ id, pr25: ra, master: rb, title: r.facts.title });
}

console.log("=== cards whose rule outcome differs between the two gate revisions ===");
if (!diffs.length) console.log("(none)");
for (const d of diffs) {
  console.log(`${d.id}  master-gate=${d.master}   PR25-gate=${d.pr25}`);
  console.log(`      ${d.title}`);
}
console.log();
console.log("cards failing under master-gate only:",
  diffs.filter((d) => d.master !== "ok" && d.pr25 === "ok").map((d) => d.id).join(", ") || "(none)");
console.log("cards failing under PR25-gate only:",
  diffs.filter((d) => d.pr25 !== "ok" && d.master === "ok").map((d) => d.id).join(", ") || "(none)");
