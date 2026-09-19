import fs from "node:fs";
const EV = "/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence";
const tasks = JSON.parse(fs.readFileSync(`${EV}/board-tasks.json`, "utf8"));
const comments = JSON.parse(fs.readFileSync(`${EV}/board-comments.json`, "utf8"));

const ids = process.argv.slice(2);
for (const id of ids) {
  const t = tasks.find((x) => x.id === id);
  if (!t) { console.log(`### ${id}: NOT FOUND`); continue; }
  console.log("=".repeat(100));
  console.log(`### ${t.id} [${t.status}] assignee=${t.assignee} created_by=${t.created_by} completed=${t.completed_at}`);
  console.log(`TITLE: ${t.title}`);
  console.log("--- body ---");
  console.log((t.body || "").slice(0, 6000));
  console.log("--- result ---");
  console.log((t.result || "").slice(0, 1500));
  for (const c of comments.filter((c) => c.task_id === id)) {
    console.log(`--- comment by ${c.author} @ ${new Date(c.created_at * 1000).toISOString()} ---`);
    console.log((c.body || "").slice(0, 2500));
  }
}
