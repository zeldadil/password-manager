// t_f4daddb9 — read-only A/B of evaluatePrRule (the only function this change
// touches) over every NOT-done card of a board snapshot, as `check
// --pre-complete` would judge it at completion time. Complements audit-ab.sh,
// which only covers done cards. One shared GitHub reader (live `gh`, read-only,
// memoised) feeds both gate revisions, so both see the very same PR list.
// Usage: node pr-ab.mjs <ref-gate.mjs> <branch-gate.mjs> <snapshot.db>
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const [refPath, newPath, snap] = process.argv.slice(2);
const ref = await import(pathToFileURL(refPath).href);
const neu = await import(pathToFileURL(newPath).href);
const rows = JSON.parse(
  execFileSync("sqlite3", ["-json", "--", snap, "SELECT id, status, assignee, title, body FROM tasks WHERE status NOT IN ('done','archived') ORDER BY id"], { encoding: "utf8", maxBuffer: 64 << 20 }) || "[]",
);
process.env.QA_GATE_GH_BUDGET_MS ||= "600000";
const gh = neu.makeGitHub({ repo: "zeldadil/password-manager" });
const prs = gh.listPullRequests();
console.log(`snapshot not-done cards: ${rows.length}; PRs read from GitHub: ${prs.length} (open ${prs.filter((p) => p.state === "OPEN").length}, closed-unmerged ${prs.filter((p) => p.state === "CLOSED").length}, merged ${prs.filter((p) => p.state === "MERGED").length})`);
const sig = (r) => JSON.stringify({ applies: r.facts.applies, v: r.violations.map((x) => x.rule).sort(), linked: (r.facts.linked_prs || []).map((p) => p.number) });
let changed = 0;
for (const t of rows) {
  const task = { id: t.id, body: t.body || "" };
  const a = ref.evaluatePrRule(task, gh);
  const b = neu.evaluatePrRule(task, gh);
  if (sig(a) === sig(b)) continue;
  changed++;
  const m = (b.facts.mentioning_prs || []).map((p) => `#${p.number}:${p.merged ? "merged" : p.state.toLowerCase()}:${p.mentioned_in.join("+")}`).join(" ");
  console.log(`CHANGED ${t.id} [${t.status}, ${t.assignee}] ${String(t.title).slice(0, 90)}`);
  console.log(`  before: ${sig(a)}`);
  console.log(`  after:  ${sig(b)}  mentions: ${m}`);
}
console.log(`not-done cards whose R9/R10 outcome changes: ${changed} of ${rows.length}`);
