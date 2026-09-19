#!/usr/bin/env node
/**
 * audit-ab.mjs — t_df8e644a whole-board audit A/B.
 *
 * Runs the same board copy through two revisions of the gate (pre-fix / post-fix)
 * with the same `--repo`, then prints each card's violation set side by side and
 * the per-card delta. The point of the AC is that the delta is exactly the one
 * false positive: `t_80fc0326` R2×3 → R2×2, no other card touched.
 *
 * Usage: node audit-ab.mjs --old <gate.mjs> --new <gate.mjs> --db <board.db> --repo <dir> --out <outdir>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(n);
  return i === -1 ? null : argv[i + 1];
};
const oldGate = arg("--old");
const newGate = arg("--new");
const db = arg("--db");
const repo = arg("--repo");
const out = arg("--out") || ".";
if (!oldGate || !newGate || !db || !repo) {
  console.error("usage: audit-ab.mjs --old <gate.mjs> --new <gate.mjs> --db <board.db> --repo <dir> [--out <dir>]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

function audit(gate, label) {
  let stdout = "";
  let code = 0;
  try {
    stdout = execFileSync("node", [gate, "audit", "--db", db, "--repo", repo, "--json"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    stdout = e.stdout || "";
    code = e.status ?? -1;
  }
  writeFileSync(join(out, `audit-${label}.json`), stdout);
  const parsed = JSON.parse(stdout);
  writeFileSync(join(out, `audit-${label}.txt`), render(parsed, gate, label));
  return { code, parsed };
}

function render(parsed, gate, label) {
  const lines = [];
  lines.push(`=== gate: ${gate}`);
  lines.push(`=== board: ${db}`);
  lines.push(`=== repo: ${repo}`);
  lines.push(`=== counts: ${JSON.stringify(parsed.counts)}`);
  lines.push("");
  for (const r of parsed.results) {
    if (!r.violations.length) continue;
    lines.push(`${r.facts.post_epoch ? "FAIL" : "FAIL(pre-epoch)"} ${r.facts.task_id}  ${r.facts.title} @${r.facts.assignee}`);
    for (const v of r.violations) lines.push(`     ${v.rule}: ${v.detail}`);
    for (const a of r.advisories) lines.push(`     (adv) ${a.rule}: ${a.detail}`);
  }
  lines.push("");
  lines.push("=== cards with NO violations:");
  const clean = parsed.results.filter((r) => !r.violations.length).map((r) => `${r.facts.task_id}${r.advisories.length ? `(adv:${r.advisories.map((a) => a.rule).join("+")})` : ""}`);
  lines.push(`   ${clean.join(" ")}`);
  return `${lines.join("\n")}\n`;
}

const set = (r) => r.violations.map((v) => v.rule).sort();
const withDetail = (r) => r.violations.map((v) => `${v.rule} ${v.detail}`).sort();

const a = audit(oldGate, "t0");
const b = audit(newGate, "t1");

console.log(`old gate exit=${a.code}  counts=${JSON.stringify(a.parsed.counts)}`);
console.log(`new gate exit=${b.code}  counts=${JSON.stringify(b.parsed.counts)}`);

const byId = (p) => new Map(p.results.map((r) => [r.facts.task_id, r]));
const A = byId(a.parsed);
const B = byId(b.parsed);
const ids = [...new Set([...A.keys(), ...B.keys()])].sort();

const changed = [];
console.log("\n-- per-card violation sets (++ = added by the fix, -- = removed by the fix):");
for (const id of ids) {
  const ra = A.get(id);
  const rb = B.get(id);
  const sa = ra ? set(ra) : [];
  const sb = rb ? set(rb) : [];
  const da = ra ? withDetail(ra) : [];
  const db_ = rb ? withDetail(rb) : [];
  const same = JSON.stringify(sa) === JSON.stringify(sb) && JSON.stringify(da) === JSON.stringify(db_);
  if (!same) changed.push(id);
  if (sa.length === 0 && sb.length === 0 && !ra?.advisories.length && !rb?.advisories.length) continue;
  const flag = same ? "  " : "!!";
  console.log(`${flag} ${id}  t0=[${sa.join(",") || "-"}]  t1=[${sb.join(",") || "-"}]`);
  if (!same) {
    const removed = da.filter((x) => !db_.includes(x));
    const added = db_.filter((x) => !da.includes(x));
    for (const x of removed) console.log(`   -- ${x}`);
    for (const x of added) console.log(`   ++ ${x}`);
  }
}
console.log(`\ncards whose violation set (rules + details) changed: ${changed.length}${changed.length ? ` -> ${changed.join(", ")}` : ""}`);
