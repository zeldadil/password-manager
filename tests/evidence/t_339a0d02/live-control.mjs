import { evaluatePrRule, makeGitHub } from "../../../scripts/qa/signoff-gate.mjs";
const real = makeGitHub({ repo: "zeldadil/password-manager" });
const gh = { ...real, listPullRequests: () => real.listPullRequests().filter((p) => p.number === 88).map((p) => ({ ...p, body: "Closes t_negctl01" })) };
const r = evaluatePrRule({ id: "t_negctl01", body: "" }, gh);
console.log(JSON.stringify({ violations: r.violations.map((v) => v.rule), advisories: r.advisories.map((a) => a.rule), judged: r.facts.judged_pr, merge_commit: r.facts.merge_commit, check_states: r.facts.check_states, manual: r.facts.manual_check_states || null, r10: (r.violations.find((v) => v.rule === "R10_MERGE_CI_NOT_GREEN") || {}).detail || null }, null, 1));
