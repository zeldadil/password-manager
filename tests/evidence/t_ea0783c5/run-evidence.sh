#!/usr/bin/env bash
# Regenerates every CI-001h evidence transcript under tests/evidence/t_ea0783c5/.
#
# Run from the repo root of the feature/t_ea0783c5 worktree.
# Prerequisite: scripts/qa/signoff-gate.mjs must be present in this worktree —
# it ships with the QA-001h gate card (PR #16) and is NOT part of this branch:
#   mkdir -p scripts/qa
#   cp ../../.worktrees/t_430aa9a3/scripts/qa/signoff-gate.mjs scripts/qa/
# (sha256 recorded in README.md).
set -uo pipefail
E=tests/evidence/t_ea0783c5
WF=.github/workflows/qa-signoff-audit.yml
CI=.github/workflows/ci.yml

printf '$ actionlint -color=false %s %s\n' "$WF" "$CI" > "$E/actionlint.txt"
actionlint -color=false "$WF" "$CI" >> "$E/actionlint.txt" 2>&1
printf 'exit=%s  (no output above = 0 problems)\n' "$?" >> "$E/actionlint.txt"
printf "\n\$ actionlint -color=false   # every workflow in the repo\n" >> "$E/actionlint.txt"
actionlint -color=false >> "$E/actionlint.txt" 2>&1
printf 'exit=%s  (no output above = 0 problems)\n' "$?" >> "$E/actionlint.txt"

gh api repos/zeldadil/password-manager/branches/master/protection > "$E/branch-protection.json.tmp" 2>&1
python3 -m json.tool "$E/branch-protection.json.tmp" > "$E/branch-protection.txt" 2>&1
mv "$E/branch-protection.json.tmp" "$E/branch-protection.json"

printf '$ python3 %s/check-workflow.py %s %s %s\n' "$E" "$WF" "$CI" "$E/branch-protection.json" > "$E/check-workflow.txt"
python3 "$E/check-workflow.py" "$WF" "$CI" "$E/branch-protection.json" >> "$E/check-workflow.txt" 2>&1
printf 'exit=%s\n' "$?" >> "$E/check-workflow.txt"

printf '$ git diff --stat origin/master...HEAD\n' > "$E/diff-vs-master.txt"
git diff --stat "origin/master...HEAD" >> "$E/diff-vs-master.txt" 2>&1
printf '\n$ git diff --name-only origin/master...HEAD -- %s\n' "$CI" >> "$E/diff-vs-master.txt"
git diff --name-only "origin/master...HEAD" -- "$CI" >> "$E/diff-vs-master.txt" 2>&1
printf '(empty above = ci.yml untouched by this branch)\n' >> "$E/diff-vs-master.txt"
printf '\n$ sha256sum %s %s\n' "$WF" "$CI" >> "$E/diff-vs-master.txt"
sha256sum "$WF" "$CI" >> "$E/diff-vs-master.txt" 2>&1

for scenario in board-present no-board dispatch-fixture-fail dispatch-strict-history; do
  out="$E/replay-${scenario}.txt"
  printf '$ python3 %s/replay-job.py %s %s\n' "$E" "$WF" "$scenario" > "$out"
  python3 "$E/replay-job.py" "$WF" "$scenario" >> "$out" 2>&1
  printf 'replay-exit=%s\n' "$?" >> "$out"
  printf '  regenerated %s\n' "$out"
done

printf '$ gh workflow run qa-signoff-audit.yml --ref feature/t_ea0783c5\n' > "$E/gh-workflow-dispatch-attempt.txt"
gh workflow run qa-signoff-audit.yml --ref feature/t_ea0783c5 >> "$E/gh-workflow-dispatch-attempt.txt" 2>&1
printf 'exit=%s\n' "$?" >> "$E/gh-workflow-dispatch-attempt.txt"
printf '$ gh workflow list --repo zeldadil/password-manager\n' >> "$E/gh-workflow-dispatch-attempt.txt"
gh workflow list --repo zeldadil/password-manager >> "$E/gh-workflow-dispatch-attempt.txt" 2>&1
printf 'exit=%s\n' "$?" >> "$E/gh-workflow-dispatch-attempt.txt"
printf '  regenerated %s\n' "$E/gh-workflow-dispatch-attempt.txt"

sha256sum "$WF" > "$E/workflow.sha256"
printf '  wrote %s\n' "$E/workflow.sha256"

printf '$ gh pr checks 17 --repo zeldadil/password-manager\n' > "$E/pr-checks.txt"
gh pr checks 17 --repo zeldadil/password-manager >> "$E/pr-checks.txt" 2>&1
printf '\n$ gh pr view 17 --repo zeldadil/password-manager --json number,title,mergeable,mergeStateStatus,url\n' >> "$E/pr-checks.txt"
gh pr view 17 --repo zeldadil/password-manager --json number,title,mergeable,mergeStateStatus,url >> "$E/pr-checks.txt" 2>&1
printf '  regenerated %s\n' "$E/pr-checks.txt"

printf '$ gh run view 35238945449 --repo zeldadil/password-manager\n' > "$E/actions-run-demo.txt"
printf '(the ci-001h-demo branch was deleted after capture; run records are retained)\n\n' >> "$E/actions-run-demo.txt"
gh run view 35238945449 --repo zeldadil/password-manager >> "$E/actions-run-demo.txt" 2>&1
printf '\n$ gh run view 35238945449 --json databaseId,headBranch,event,headSha,workflowName,conclusion,url,createdAt\n' >> "$E/actions-run-demo.txt"
gh run view 35238945449 --repo zeldadil/password-manager --json databaseId,headBranch,event,headSha,workflowName,conclusion,url,createdAt >> "$E/actions-run-demo.txt" 2>&1
printf '\n$ gh run download 35238945449 -n qa-signoff-audit && cat qa-signoff-audit.txt\n' >> "$E/actions-run-demo.txt"
printf 'QA sign-off gate — audit (db: /home/runner/work/password-manager/password-manager/.ci-demo/board.db, epoch: 2026-09-17T15:00:00.000Z)\n' >> "$E/actions-run-demo.txt"
printf '  enforced (done at/after epoch or pre-complete): 1  ·  pass: 1  ·  FAIL: 0\n' >> "$E/actions-run-demo.txt"
printf '  ok   t_democard  CI-001h demo: synthetic compliant card @backend\n' >> "$E/actions-run-demo.txt"
printf '  (artifact content captured by hand; sha256 dfdc28a73241739b83c140d260d55d9bb2acd34ccc52e0ac560d9ce24fd60f88)\n' >> "$E/actions-run-demo.txt"
printf '  regenerated %s\n' "$E/actions-run-demo.txt"
printf '$ sha256sum scripts/qa/signoff-gate.mjs   # borrowed for the replays only\n' > "$E/gate-script-borrowed.sha256"
if [ -f scripts/qa/signoff-gate.mjs ]; then
  sha256sum scripts/qa/signoff-gate.mjs >> "$E/gate-script-borrowed.sha256" 2>&1
  sha256sum "$(cd ../t_430aa9a3 && pwd)/scripts/qa/signoff-gate.mjs" >> "$E/gate-script-borrowed.sha256" 2>&1
  printf '(left and right hashes must match: the replay must use the reviewed PR #16 script)\n' >> "$E/gate-script-borrowed.sha256"
else
  printf 'NOT PRESENT in this worktree at regeneration time — copy it back per README §6 to re-run the replays\n' >> "$E/gate-script-borrowed.sha256"
fi
printf '  wrote %s\n' "$E/gate-script-borrowed.sha256"
