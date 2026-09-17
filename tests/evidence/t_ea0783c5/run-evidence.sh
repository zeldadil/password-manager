#!/usr/bin/env bash
# Regenerates every CI-001h evidence transcript under tests/evidence/t_ea0783c5/.
# Run from the repo root of the feature/t_ea0783c5 worktree.
set -uo pipefail
E=tests/evidence/t_ea0783c5
WF=.github/workflows/qa-signoff-audit.yml
CI=.github/workflows/ci.yml

printf '$ actionlint -color=false %s %s\n' "$WF" "$CI" > "$E/actionlint.txt"
actionlint -color=false "$WF" "$CI" >> "$E/actionlint.txt" 2>&1
printf 'exit=%s  (no output above = 0 problems)\n' "$?" >> "$E/actionlint.txt"
printf "\n$ actionlint -color=false   # every workflow in the repo\n" >> "$E/actionlint.txt"
actionlint -color=false >> "$E/actionlint.txt" 2>&1
printf 'exit=%s  (no output above = 0 problems)\n' "$?" >> "$E/actionlint.txt"

printf '$ python3 %s/check-workflow.py %s %s\n' "$E" "$WF" "$CI" > "$E/check-workflow.txt"
python3 "$E/check-workflow.py" "$WF" "$CI" >> "$E/check-workflow.txt" 2>&1
printf 'exit=%s\n' "$?" >> "$E/check-workflow.txt"

for scenario in board-present no-board dispatch-fixture-fail dispatch-strict-history; do
  out="$E/replay-${scenario}.txt"
  printf '$ python3 %s/replay-job.py %s %s\n' "$E" "$WF" "$scenario" > "$out"
  python3 "$E/replay-job.py" "$WF" "$scenario" >> "$out" 2>&1
  printf 'replay-exit=%s\n' "$?" >> "$out"
  printf '  regenerated %s\n' "$out"
done

printf '$ gh workflow run %s --ref feature/t_ea0783c5\n' "qa-signoff-audit.yml" > "$E/gh-workflow-dispatch-attempt.txt"
gh workflow run qa-signoff-audit.yml --ref feature/t_ea0783c5 >> "$E/gh-workflow-dispatch-attempt.txt" 2>&1
printf 'exit=%s\n' "$?" >> "$E/gh-workflow-dispatch-attempt.txt"
printf '$ gh workflow list --repo zeldadil/password-manager\n' >> "$E/gh-workflow-dispatch-attempt.txt"
gh workflow list --repo zeldadil/password-manager >> "$E/gh-workflow-dispatch-attempt.txt" 2>&1
printf 'exit=%s\n' "$?" >> "$E/gh-workflow-dispatch-attempt.txt"
printf '  regenerated %s\n' "$E/gh-workflow-dispatch-attempt.txt"

sha256sum "$WF" > "$E/workflow.sha256"
printf '  wrote %s\n' "$E/workflow.sha256"
