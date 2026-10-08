// Prints, for every live comment carrying the exception key, each occurrence with
// whether it is inside a code span/fence (using the gate's own codeRanges).
// Usage: node occurrences.mjs <repo-dir>
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const repo = process.argv[2];
const { codeRanges } = await import(pathToFileURL(join(repo, "scripts/qa/signoff-gate.mjs")).href);
const db = join(process.env.HOME, ".hermes/kanban.db");
const rows = JSON.parse(
  execFileSync("sqlite3", ["-readonly", "-json", db,
    "SELECT id, task_id, author, body FROM task_comments WHERE body LIKE '%signoff%exception%' ORDER BY id;"], { encoding: "utf8" }) || "[]",
);
const RE = /qa[\s_-]*signoff[\s_-]*exception\s*[:\-—]+\s*(\S[^\n]*)/gi;
for (const r of rows) {
  const ranges = codeRanges(r.body);
  const hits = [...r.body.matchAll(RE)].map((m) => ({
    at: m.index,
    quoted: ranges.some(([a, b]) => m.index >= a && m.index < b),
    reason: m[1].slice(0, 50),
  }));
  console.log(JSON.stringify({ comment: r.id, task: r.task_id, author: r.author, hits }));
}
