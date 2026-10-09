#!/usr/bin/env node
// t_dbecf24d — one-line (or --json) summary of a hook-env-gh-probe.mjs report.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const asJson = args[0] === "--json";
const file = asJson ? args[1] : args[0];
const r = JSON.parse(readFileSync(file, "utf8"));
const rules = r.gate_check.rules || { violations: [], advisories: [] };
const s = {
  auth_exit: r.gh_auth_status.exit,
  auth: r.gh_auth_status.lines.join(" | "),
  home: r.env.HOME,
  gh: r.env.gh_path,
  gh_token_env: r.env.GH_TOKEN_set || r.env.GITHUB_TOKEN_set,
  gate_sha12: (r.installed_gate.sha256 || "").slice(0, 12),
  r9: rules.violations.includes("R9_PR_NOT_MERGED"),
  a11: rules.advisories.includes("A11_CI_STATE_UNVERIFIABLE"),
  violations: rules.violations,
  parseError: r.gate_check.parseError,
};
if (asJson) console.log(JSON.stringify(s));
else
  console.log(
    `gh auth exit=${s.auth_exit} [${s.auth}] HOME=${s.home} gh=${s.gh} token-env=${s.gh_token_env} · installed gate ${s.gate_sha12}… check: R9=${s.r9} A11=${s.a11} violations=${s.violations.join(",") || "-"}${s.parseError ? ` parseError=${s.parseError}` : ""}`,
  );
