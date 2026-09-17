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
printf '$ sha256sum scripts/qa/signoff-gate.mjs   # borrowed for the replays only\n' > "$E/gate-script-borrowed.sha256"
sha256sum scripts/qa/signoff-gate.mjs >> "$E/gate-script-borrowed.sha256" 2>&1
sha256sum "$(cd ../t_430aa9a3 && pwd)/scripts/qa/signoff-gate.mjs" >> "$E/gate-script-borrowed.sha256" 2>&1
printf '  wrote %s\n' "$E/gate-script-borrowed.sha256"
