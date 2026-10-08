// Reads `signoff-gate.mjs check --json` on stdin and prints the §5.9 facts only
// (linked / mentioning PRs, R9/R10 and A11–A14). No secret can appear here: the
// gate output carries PR numbers, states, branch names and rule ids.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    console.log(`unparseable gate output: ${raw.slice(0, 300)}`);
    return;
  }
  const pr = (j.facts && j.facts.pr_rule) || {};
  const fmt = (p) => `#${p.number} ${p.state}${p.merged ? " merged" : ""} head=${p.head}${p.link ? ` link=${p.link}` : ""}${p.mentioned_in ? ` mentioned_in=${p.mentioned_in.join("+")}` : ""}`;
  console.log(`applies: ${pr.applies}  judged_pr: ${pr.judged_pr ?? null}`);
  console.log(`linked_prs:     ${(pr.linked_prs || []).map(fmt).join(" | ") || "(none)"}`);
  console.log(`mentioning_prs: ${pr.mentioning_prs === undefined ? "(field absent)" : (pr.mentioning_prs.map(fmt).join(" | ") || "(none)")}`);
  const keep = (r) => /^(R9|R10|A1[1-4])_/.test(r.rule);
  for (const v of (j.violations || []).filter(keep)) console.log(`VIOLATION ${v.rule}: ${v.detail}`);
  for (const a of (j.advisories || []).filter(keep)) console.log(`advisory  ${a.rule}: ${a.detail}`);
  const others = (j.violations || []).filter((v) => !keep(v)).map((v) => v.rule);
  console.log(`other (non-§5.9) violations: ${others.length ? others.join(", ") : "none"}`);
});
