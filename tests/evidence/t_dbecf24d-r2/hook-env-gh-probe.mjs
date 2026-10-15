#!/usr/bin/env node
// t_dbecf24d — probe what the QA sign-off gate sees from INSIDE a real Hermes hook subprocess.
//
// Used as the hook's gate script via SIGNOFF_GATE_SCRIPT (scripts/qa/hooks/qa-signoff-gate.sh
// honours `${SIGNOFF_GATE_SCRIPT:-<agent-hooks>/signoff-gate.mjs}`), and fired through
// `hermes hooks test pre_tool_call --for-tool kanban_complete` — i.e. the real dispatcher path,
// the real `qa-signoff-gate.sh` of the profile, the env Hermes builds for hook subprocesses
// (agent/shell_hooks.py::_spawn → build_subprocess_env). Nothing here runs in an interactive shell.
//
// It records, per profile:
//   1. `gh auth status` exit code + the "Logged in to <host> account <user>" line (the token line
//      is never written: gh masks it, but even a masked prefix is not evidence material);
//   2. HOME / HERMES_HOME / whether GH_TOKEN / GITHUB_TOKEN are set (names only, never values);
//   3. the INSTALLED gate (<HERMES_HOME>/agent-hooks/signoff-gate.mjs) run as
//      `check --task $PROBE_TASK --pre-complete --json` in this same env: the rule ids of
//      violations + advisories, so "R9 and not A11" is read from the gate's own output.
// The report goes to $PROBE_OUT_DIR/<profile>.json. stdout is `{}` (allow) so the probe never
// blocks anything.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

try {
  readFileSync(0, "utf8"); // drain the hook payload
} catch {}

const home = process.env.HERMES_HOME || "";
const profile = basename(home) || "unknown";
const outDir = process.env.PROBE_OUT_DIR || "/tmp";
const task = process.env.PROBE_TASK || "t_20f78461";

function run(cmd, args, extraEnv = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 25000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...extraEnv },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? (e.code === "ENOENT" ? 127 : -1), stdout: (e.stdout || "").toString(), stderr: (e.stderr || e.message || "").toString() };
  }
}

const auth = run("gh", ["auth", "status", "--hostname", "github.com"], { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" });
const authText = `${auth.stdout}\n${auth.stderr}`;
const loggedIn = authText.split("\n").map((l) => l.trim()).filter((l) => /Logged in to|not logged|failed|error/i.test(l) && !/Token/i.test(l));

const gate = join(home, "agent-hooks", "signoff-gate.mjs");
const sha = run("sha256sum", [gate]).stdout.split(" ")[0] || null;
const check = run(process.execPath, [gate, "check", "--task", task, "--pre-complete", "--json"]);
let rules = null;
let parseError = null;
try {
  const j = JSON.parse(check.stdout);
  rules = {
    violations: j.violations.map((v) => v.rule),
    advisories: j.advisories.map((a) => a.rule),
    r9_detail: (j.violations.find((v) => v.rule === "R9_PR_NOT_MERGED") || {}).detail || null,
    a11_detail: (j.advisories.find((a) => a.rule === "A11_CI_STATE_UNVERIFIABLE") || {}).detail || null,
    pr_rule: j.facts && j.facts.pr_rule ? { applies: j.facts.pr_rule.applies, in_scope: j.facts.pr_rule.in_scope } : null,
  };
} catch (e) {
  parseError = `${e.message}; stderr: ${check.stderr.slice(0, 300)}`;
}

const report = {
  profile,
  probe: "inside the real pre_tool_call hook subprocess (hermes hooks test → <profile>/agent-hooks/qa-signoff-gate.sh)",
  env: {
    HOME: process.env.HOME || null,
    HERMES_HOME: home,
    HERMES_KANBAN_DB: process.env.HERMES_KANBAN_DB || null,
    QA_GATE_GITHUB: process.env.QA_GATE_GITHUB || null,
    GH_TOKEN_set: Boolean(process.env.GH_TOKEN),
    GITHUB_TOKEN_set: Boolean(process.env.GITHUB_TOKEN),
    gh_path: run("sh", ["-c", "command -v gh"]).stdout.trim() || null,
    node: process.version,
  },
  gh_auth_status: { exit: auth.code, lines: loggedIn },
  installed_gate: { path: gate, sha256: sha },
  gate_check: { task, exit: check.code, rules, parseError },
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${profile}.json`), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write("{}\n");
process.exit(0);
