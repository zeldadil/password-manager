#!/usr/bin/env node
// t_75180b28 — print the R9/R10/A11/A12 part of a gate `--json` result.
//   node summarize.mjs <check.json>            one card
//   node summarize.mjs <audit.json> --audit    every done card the PR rule judged
import { readFileSync } from "node:fs";

const [file, flag] = process.argv.slice(2);
let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.log(`  (not JSON: ${e.message}) ${readFileSync(file, "utf8").slice(0, 300)}`);
  process.exit(0);
}
const PR = /^(R9|R10|A11|A12|A13)_/;
const line = (r) => {
  const pr = r.facts.pr_rule || {};
  const linked = (pr.linked_prs || []).map((p) => `#${p.number}:${p.merged ? `merged→${p.base}` : p.state.toLowerCase()}`).join(" ");
  const out = [
    `  ${r.facts.task_id}  ${String(r.facts.title || "").slice(0, 70)}`,
    `      pr_rule: in_scope=${pr.in_scope} applies=${pr.applies} linked=[${linked}] judged=${pr.judged_pr ?? "-"} merge_commit=${pr.merge_commit ? pr.merge_commit.slice(0, 12) : "-"}`,
  ];
  if (pr.check_states) out.push(`      check_states: ${JSON.stringify(pr.check_states)}`);
  if (pr.pushed_branches && pr.pushed_branches.length) out.push(`      pushed_branches: ${pr.pushed_branches.join(", ")}`);
  for (const v of r.violations) out.push(`      ${PR.test(v.rule) ? "VIOLATION" : "other-rule"} ${v.rule}: ${v.detail}`);
  for (const a of r.advisories) if (PR.test(a.rule)) out.push(`      advisory ${a.rule}: ${a.detail}`);
  return out.join("\n");
};
if (flag === "--audit") {
  const judged = data.results.filter((r) => r.facts.pr_rule && r.facts.pr_rule.in_scope);
  const applies = judged.filter((r) => r.facts.pr_rule.applies);
  const prFail = judged.filter((r) => r.violations.some((v) => PR.test(v.rule)));
  console.log(`done cards: ${data.results.length} · in PR-rule scope: ${judged.length} · code cards: ${applies.length} · R9/R10 failures: ${prFail.length}`);
  for (const r of applies) console.log(line(r));
} else {
  console.log(line(data));
}
