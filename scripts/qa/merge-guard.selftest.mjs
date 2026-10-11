#!/usr/bin/env node
/**
 * merge-guard.selftest.mjs — SEC-GATE / t_30e17642 non-vacuity proof for
 * scripts/qa/merge-guard.mjs and the shell wrapper scripts/qa/hooks/merge-guard.sh.
 *
 * Every case runs the guard as a SUBPROCESS in `hook` mode with a payload shaped
 * like the one Hermes sends on stdin (agent/shell_hooks.py _payload_fields:
 * hook_event_name, tool_name, tool_input, session_id, cwd, profile, extra) and
 * asserts the decision AND the exit code:
 *   BLOCK → stdout {"decision":"block","reason":…} naming the expected rule and §5.9, exit 2
 *   ALLOW → stdout {}, exit 0
 *
 * Sections:
 *   A. merge forms that must be refused (CLI, REST, GraphQL, alias, MCP, wrappers,
 *      shells, substitutions, pipes, heredocs, every guarded tool)
 *   B. neighbouring commands that must stay allowed (AC2 false-positive list + mentions)
 *   C. fail-closed behaviour (malformed payload; wrapper with node missing / gate missing)
 *   D. the shell wrapper end-to-end (same payload through merge-guard.sh)
 *
 * Exit 0 = all cases pass · exit 1 = at least one case failed (printed with detail).
 * Usage: node scripts/qa/merge-guard.selftest.mjs [--verbose]
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "merge-guard.mjs");
const WRAPPER = join(HERE, "hooks", "merge-guard.sh");
const VERBOSE = process.argv.includes("--verbose");

const payload = (tool, input) =>
  JSON.stringify({
    hook_event_name: "pre_tool_call",
    tool_name: tool,
    tool_input: input,
    session_id: "sess_selftest",
    cwd: "/tmp",
    profile: "qa",
    extra: { task_id: "t_selftest", tool_call_id: "call_1" },
  });

const T = (command) => ["terminal", { command }];
const PR = "zeldadil/password-manager";

// ── A. must be refused ───────────────────────────────────────────────────────
const BLOCK = [
  ["gh pr merge, plain squash", T("gh pr merge 124 --squash --delete-branch"), "R_GH_PR_MERGE"],
  ["gh pr merge, no number (current branch)", T("gh pr merge"), "R_GH_PR_MERGE"],
  ["gh pr merge -R after the number", T(`gh pr merge 124 -R ${PR} --squash`), "R_GH_PR_MERGE"],
  ["gh pr merge --repo before the number", T(`gh pr merge --repo ${PR} 124 --merge`), "R_GH_PR_MERGE"],
  ["gh pr merge --repo=…", T(`gh pr merge --repo=${PR} 124 --rebase`), "R_GH_PR_MERGE"],
  ["gh -R … pr merge (flag before the subcommand)", T(`gh -R ${PR} pr merge 124`), "R_GH_PR_MERGE"],
  ["gh pr -R … merge (flag between)", T(`gh pr -R ${PR} merge 124`), "R_GH_PR_MERGE"],
  ["gh pr merge --auto", T("gh pr merge 124 --auto --squash"), "R_GH_PR_MERGE"],
  ["gh pr merge --admin", T("gh pr merge 124 --admin --squash"), "R_GH_PR_MERGE"],
  ["after &&", T("cd /tmp/repo && gh pr merge 124 --squash"), "R_GH_PR_MERGE"],
  ["after ;", T("git push origin HEAD; gh pr merge 124 --squash"), "R_GH_PR_MERGE"],
  ["after ||", T("gh pr checks 124 || gh pr merge 124 --admin"), "R_GH_PR_MERGE"],
  ["on a second line", T("git fetch -q origin\ngh pr merge 124 --squash"), "R_GH_PR_MERGE"],
  ["piped to tee", T("gh pr merge 124 --squash 2>&1 | tee merge.log"), "R_GH_PR_MERGE"],
  ["inside a subshell", T("(cd repo; gh pr merge 124)"), "R_GH_PR_MERGE"],
  ["inside if/then", T("if gh pr checks 124; then gh pr merge 124 --squash; fi"), "R_GH_PR_MERGE"],
  ["behind env assignments", T(`GH_TOKEN=redacted GH_REPO=${PR} gh pr merge 124`), "R_GH_PR_MERGE"],
  ["absolute path to gh", T("/usr/bin/gh pr merge 124"), "R_GH_PR_MERGE"],
  ["quoted command words", T('"gh" "pr" "merge" 124'), "R_GH_PR_MERGE"],
  ["backslash-continued line", T("gh pr \\\n  merge 124 \\\n  --squash"), "R_GH_PR_MERGE"],
  ["behind sudo/env/timeout", T("sudo -u sap env FOO=1 timeout 60 gh pr merge 124"), "R_GH_PR_MERGE"],
  ["via xargs", T("echo 124 | xargs gh pr merge --squash"), "R_GH_PR_MERGE"],
  ["via xargs -I", T("gh pr list --json number -q '.[].number' | xargs -I{} gh pr merge {} --squash"), "R_GH_PR_MERGE"],
  ["via find -exec", T("find . -maxdepth 0 -exec gh pr merge 124 \\;"), "R_GH_PR_MERGE"],
  ["bash -c '…'", T("bash -c 'gh pr merge 124 --squash'"), "R_GH_PR_MERGE"],
  ["bash -lc with && inside", T('bash -lc "cd repo && gh pr merge 124"'), "R_GH_PR_MERGE"],
  ["eval", T('eval "gh pr merge 124"'), "R_GH_PR_MERGE"],
  ["watch '…'", T("watch -n 60 'gh pr merge 124'"), "R_GH_PR_MERGE"],
  ["ssh host '…'", T("ssh localhost 'gh pr merge 124'"), "R_GH_PR_MERGE"],
  ["$( … ) substitution", T("out=$(gh pr merge 124 --squash)"), "R_GH_PR_MERGE"],
  ["backticks inside double quotes", T('echo "merged: `gh pr merge 124`"'), "R_GH_PR_MERGE"],
  ["$( … ) inside double quotes of a data command", T('echo "result $(gh pr merge 124)"'), "R_GH_PR_MERGE"],
  ["echo … | bash", T("echo 'gh pr merge 124' | bash"), "R_GH_PR_MERGE"],
  ["heredoc fed to bash", T("bash <<'EOF'\ngh pr merge 124\nEOF"), "R_GH_PR_MERGE"],
  ["heredoc piped to sh", T("cat <<EOF | sh\ngh pr merge 124\nEOF"), "R_GH_PR_MERGE"],
  ["here-string to bash", T("bash <<< 'gh pr merge 124'"), "R_GH_PR_MERGE"],
  ["python3 -c subprocess list", T(`python3 -c "import subprocess; subprocess.run(['gh','pr','merge','124'])"`), "R_GH_PR_MERGE"],
  ["python3 heredoc os.system", T("python3 - <<'EOF'\nimport os\nos.system('gh pr merge 124')\nEOF"), "R_GH_PR_MERGE"],
  ["gh api -X PUT …/merge", T(`gh api -X PUT repos/${PR}/pulls/124/merge -f merge_method=squash`), "R_API_PULL_MERGE"],
  ["gh api --method PUT with {owner}/{repo}", T("gh api --method PUT repos/{owner}/{repo}/pulls/124/merge"), "R_API_PULL_MERGE"],
  ["gh api …/merge -R style, default method", T(`gh api repos/${PR}/pulls/124/merge`), "R_API_PULL_MERGE"],
  ["gh api with a shell variable", T(`N=124; gh api -X PUT "repos/${PR}/pulls/$N/merge"`), "R_API_PULL_MERGE"],
  ["curl -X PUT", T(`curl -sS -X PUT -H "Accept: application/vnd.github+json" https://api.github.com/repos/${PR}/pulls/124/merge`), "R_API_PULL_MERGE"],
  ["REST branch merge (no PR)", T(`gh api -X POST repos/${PR}/merges -f base=master -f head=qa/x`), "R_API_BRANCH_MERGE"],
  ["GraphQL mergePullRequest", T(`gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:"PR_x"}) { clientMutationId } }'`), "R_GRAPHQL_MERGE"],
  ["GraphQL enablePullRequestAutoMerge", T(`gh api graphql -f query='mutation { enablePullRequestAutoMerge(input:{pullRequestId:"PR_x"}) { clientMutationId } }'`), "R_GRAPHQL_MERGE"],
  ["gh alias set to pr merge", T("gh alias set m 'pr merge --squash'"), "R_GH_ALIAS_MERGE"],
  ["gh alias import (content not visible)", T("gh alias import aliases.yml"), "R_GH_ALIAS_MERGE"],
  ["execute_code: subprocess list", ["execute_code", { code: 'import subprocess\nsubprocess.run(["gh", "pr", "merge", "124", "--squash"])' }], "R_GH_PR_MERGE"],
  ["execute_code: terminal() string", ["execute_code", { code: 'from hermes_tools import terminal\nterminal("gh pr merge 124 -R zeldadil/password-manager")' }], "R_GH_PR_MERGE"],
  ["execute_code: urllib PUT", ["execute_code", { code: `import urllib.request\nurllib.request.Request("https://api.github.com/repos/${PR}/pulls/124/merge", method="PUT")` }], "R_API_PULL_MERGE"],
  ["process_manage submit to a pty shell", ["process_manage", { action: "submit", session_id: "proc_1", data: "gh pr merge 124" }], "R_GH_PR_MERGE"],
  ["tool_call wrapping terminal", ["tool_call", { calls: [{ name: "terminal", arguments: { command: "gh pr merge 124 --squash" } }] }], "R_GH_PR_MERGE"],
  ["tool_call wrapping the MCP merge tool", ["tool_call", { calls: [{ name: "mcp__github__merge_pull_request", arguments: { owner: "zeldadil", repo: "password-manager", pull_number: 124 } }] }], "R_MCP_MERGE_TOOL"],
  ["MCP github merge_pull_request", ["mcp__github__merge_pull_request", { owner: "zeldadil", repo: "password-manager", pull_number: 124, merge_method: "squash" }], "R_MCP_MERGE_TOOL"],
];

// ── B. must stay allowed ─────────────────────────────────────────────────────
const ALLOW = [
  ["gh pr view --json mergeable…", T("gh pr view 124 --json mergeable,mergeStateStatus,baseRefName")],
  ["gh pr view state,mergedAt", T(`gh pr view 124 -R ${PR} --json state,mergedAt,mergeCommit`)],
  ["gh pr checks", T("gh pr checks 124")],
  ["gh pr create", T('gh pr create --base master --head qa/t_30e17642-merge-guard --title "x" --body "Closes t_30e17642"')],
  ["gh pr create whose body mentions gh pr merge", T('gh pr create --title "merge-guard" --body "After review architect runs gh pr merge 124 --squash"')],
  ["gh pr list", T(`gh pr list -R ${PR} --state open`)],
  ["gh pr diff / status / checkout / review", T('gh pr diff 124 && gh pr status && gh pr checkout 124 && gh pr review 124 --comment -b "QA-VERDICT: pass"')],
  ["git merge-base", T("git merge-base --is-ancestor HEAD origin/master")],
  ["git merge (local)", T("git merge origin/master")],
  ["git merge --no-ff -m", T('git merge --no-ff feature/x -m "merge feature/x"')],
  ["git log --merges", T("git log --merges --oneline -5")],
  ["gh api on the PR (no /merge)", T(`gh api repos/${PR}/pulls/124`)],
  ["gh run list", T("gh run list --branch master --limit 5")],
  ["commit message mentions gh pr merge", T('git commit -m "docs: never run gh pr merge yourself"')],
  ["echo mentions gh pr merge", T('echo "gh pr merge is architect-only"')],
  ["grep for gh pr merge", T('grep -rn "gh pr merge" CLAUDE.md')],
  ["hermes kanban comment mentions it", T('hermes kanban comment t_x "do not run gh pr merge 124"')],
  ["heredoc written to a file", T("cat > notes.md <<'EOF'\nArchitect runs gh pr merge 124\nEOF")],
  ["word merge elsewhere", T("pnpm --filter web test -- merge-utils && node scripts/qa/signoff-gate.mjs audit")],
  ["gh pr view piped to jq", T("gh pr view 124 --json mergeable | jq .mergeable")],
  ["execute_code without a merge", ["execute_code", { code: 'from hermes_tools import terminal\nprint(terminal("gh pr view 124 --json state"))' }]],
  ["process_manage poll", ["process_manage", { action: "poll", session_id: "proc_1" }]],
  ["tool_call wrapping gh pr checks", ["tool_call", { calls: [{ name: "terminal", arguments: { command: "gh pr checks 124" } }] }]],
  ["MCP github get_pull_request", ["mcp__github__get_pull_request", { owner: "zeldadil", repo: "password-manager", pull_number: 124 }]],
];

let pass = 0;
let fail = 0;
const failures = [];

function run(cmd, args, input, env) {
  return spawnSync(cmd, args, { input, encoding: "utf8", env: env ?? process.env, timeout: 20000 });
}

function expectBlock(label, out, rule) {
  let parsed = null;
  try { parsed = JSON.parse(out.stdout.trim()); } catch { /* checked below */ }
  const ok =
    out.status === 2 &&
    parsed?.decision === "block" &&
    typeof parsed.reason === "string" &&
    (rule ? parsed.reason.includes(rule) : true) &&
    parsed.reason.includes("le merge revient à architect") &&
    parsed.reason.includes("§5.9");
  record(ok, label, `expected BLOCK ${rule ?? ""} (exit 2), got exit ${out.status} stdout=${out.stdout.trim().slice(0, 300)} stderr=${(out.stderr || "").trim().slice(0, 200)}`);
}

function expectAllow(label, out) {
  const ok = out.status === 0 && out.stdout.trim() === "{}";
  record(ok, label, `expected ALLOW ({} exit 0), got exit ${out.status} stdout=${out.stdout.trim().slice(0, 300)}`);
}

function record(ok, label, detail) {
  if (ok) { pass++; if (VERBOSE) console.log(`  ok   ${label}`); }
  else { fail++; failures.push(`${label}\n       ${detail}`); console.log(`  FAIL ${label}\n       ${detail}`); }
}

console.log(`merge-guard selftest — gate: ${GATE}`);
console.log(`\nA. refused merge forms (${BLOCK.length})`);
for (const [label, [tool, input], rule] of BLOCK) expectBlock(`A ${label}`, run("node", [GATE, "hook"], payload(tool, input)), rule);
console.log(`\nB. allowed neighbouring commands (${ALLOW.length})`);
for (const [label, [tool, input]] of ALLOW) expectAllow(`B ${label}`, run("node", [GATE, "hook"], payload(tool, input)));

console.log("\nC. fail-closed behaviour");
expectBlock("C malformed JSON payload", run("node", [GATE, "hook"], "{not json"), "R_PAYLOAD_PARSE");
expectBlock("C empty payload", run("node", [GATE, "hook"], ""), "R_PAYLOAD_PARSE");
expectBlock("C JSON array payload", run("node", [GATE, "hook"], "[]"), "R_PAYLOAD_PARSE");
expectAllow("C payload with args instead of tool_input (allow)", run("node", [GATE, "hook"], JSON.stringify({ tool_name: "terminal", args: { command: "gh pr view 1" } })));
expectBlock("C payload with args instead of tool_input (block)", run("node", [GATE, "hook"], JSON.stringify({ tool_name: "terminal", args: { command: "gh pr merge 1" } })), "R_GH_PR_MERGE");

const scratch = mkdtempSync(join(tmpdir(), "merge-guard-selftest-"));
try {
  // Wrapper with no node on PATH → must fail closed.
  const bin = join(scratch, "bin");
  mkdirSync(bin);
  for (const tool of ["cat", "dirname", "bash"]) {
    const found = spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    if (found) symlinkSync(found, join(bin, tool));
  }
  const bashPath = spawnSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
  expectBlock(
    "C wrapper fails closed when node is not on PATH",
    run(bashPath, [WRAPPER], payload("terminal", { command: "gh pr view 1" }), { PATH: bin }),
    null,
  );
  // Wrapper whose gate script is missing → must fail closed.
  const lonely = join(scratch, "lonely");
  mkdirSync(lonely);
  copyFileSync(WRAPPER, join(lonely, "merge-guard.sh"));
  chmodSync(join(lonely, "merge-guard.sh"), 0o755);
  expectBlock(
    "C wrapper fails closed when merge-guard.mjs is missing",
    run(bashPath, [join(lonely, "merge-guard.sh")], payload("terminal", { command: "gh pr view 1" }), { ...process.env, MERGE_GUARD_SCRIPT: "" }),
    null,
  );

  console.log("\nD. shell wrapper end-to-end (gate resolved via MERGE_GUARD_SCRIPT)");
  const env = { ...process.env, MERGE_GUARD_SCRIPT: GATE };
  expectBlock("D wrapper blocks gh pr merge", run(bashPath, [WRAPPER], payload("terminal", { command: `gh pr merge 999999 -R ${PR} --squash` }), env), "R_GH_PR_MERGE");
  expectBlock("D wrapper blocks gh api PUT …/merge", run(bashPath, [WRAPPER], payload("terminal", { command: `gh api -X PUT repos/${PR}/pulls/999999/merge` }), env), "R_API_PULL_MERGE");
  expectAllow("D wrapper allows gh pr view", run(bashPath, [WRAPPER], payload("terminal", { command: "gh pr view 999999" }), env));
  expectAllow("D wrapper allows git merge-base", run(bashPath, [WRAPPER], payload("terminal", { command: "git merge-base HEAD origin/master" }), env));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\nmerge-guard selftest: ${pass} passed, ${fail} failed (${BLOCK.length} refused forms, ${ALLOW.length} allowed neighbours)`);
process.exit(fail ? 1 : 0);
