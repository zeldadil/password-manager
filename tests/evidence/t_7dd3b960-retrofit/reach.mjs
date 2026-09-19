#!/usr/bin/env node
// SEC-001 acceptance criterion 5: does the board's task_links graph actually gate
// every BE-002*/BE-003*/BR-002*/BR-003*/FE-002*/FE-003* card behind t_9840ccdd?
// Method: transitive closure over task_links(parent -> child) starting at SEC-001.
import { execFileSync } from "node:child_process";
const DB = process.env.HOME + "/.hermes/kanban.db";
const q = (sql) => JSON.parse(execFileSync("sqlite3", ["-json", "--", DB, sql], { encoding: "utf8" }) || "[]");
const links = q("SELECT parent_id, child_id FROM task_links;");
const tasks = q("SELECT id, title, status FROM tasks;");
const byId = new Map(tasks.map((t) => [t.id, t]));
const children = new Map();
for (const l of links) {
  if (!children.has(l.parent_id)) children.set(l.parent_id, []);
  children.get(l.parent_id).push(l.child_id);
}
const ROOT = "t_9840ccdd";
const seen = new Set();
const stack = [ROOT];
while (stack.length) {
  const id = stack.pop();
  for (const c of children.get(id) || []) {
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(c);
  }
}
seen.delete(ROOT);
const prefixes = ["BE-002", "BE-003", "BR-002", "BR-003", "FE-002", "FE-003"];
const inScope = tasks.filter((t) => prefixes.some((p) => (t.title || "").startsWith(p)));
const gated = inScope.filter((t) => seen.has(t.id));
const notGated = inScope.filter((t) => !seen.has(t.id));
console.log(`root: ${ROOT} (${byId.get(ROOT)?.title})`);
console.log(`reachable descendants: ${seen.size}`);
console.log(`in-scope family cards: ${inScope.length}`);
console.log(`  gated transitively by ${ROOT}: ${gated.length}`);
console.log(`  NOT gated: ${notGated.length}`);
for (const t of notGated) console.log(`    MISSING ${t.id} ${t.title} [${t.status}]`);
console.log(`\nper-prefix:`);
for (const p of prefixes) {
  const fam = inScope.filter((t) => t.title.startsWith(p));
  console.log(`  ${p}: ${fam.filter((t) => seen.has(t.id)).length}/${fam.length} gated`);
}
console.log(`\nroot-depth-1 children of ${ROOT}: ${(children.get(ROOT) || []).map((c) => `${c}(${(byId.get(c)?.title || "").slice(0, 12)})`).join(", ")}`);
