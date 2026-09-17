#!/usr/bin/env bash
# Final detail capture: public master tip text, FP classification, ignore-file presence.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
cd "$WS/repo.git" || exit 1
REDACT='s/[0-9]{8,12}:[A-Za-z0-9_-]{35}/[REDACTED-TOKEN]/g'

echo "=== PUBLIC master tip (118e524) PROJECT_BRIEF.md L84-90 ==="
git show 118e524:PROJECT_BRIEF.md | sed -n '84,90p'
echo
echo "=== generic-api-key FP check: selftest.mjs L349-357 @ 8a8b2e3 (redacted) ==="
git show 8a8b2e3:scripts/qa/signoff-gate.selftest.mjs | sed -n '349,357p' | perl -pe "$REDACT"
echo
echo "=== public master HEAD tree: .gitleaksignore present? ==="
git ls-tree 118e524 --name-only | grep -i gitleaks || echo "  (absent)"
echo
echo "=== count: public branch tips carrying raw token / total public branches ==="
TIPS=0
TOTAL=0
for ref in $(git for-each-ref --format='%(refname)' refs/heads); do
  TOTAL=$((TOTAL+1))
  n=$(git grep -c -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$ref" -- PROJECT_BRIEF.md 2>/dev/null | wc -l)
  if [ "$n" -gt 0 ]; then TIPS=$((TIPS+1)); fi
done
echo "  $TIPS of $TOTAL public branch tips expose the raw token in PROJECT_BRIEF.md"
