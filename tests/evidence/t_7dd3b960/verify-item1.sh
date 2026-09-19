#!/usr/bin/env bash
# Item 1 verification: lint the two audit-workflow revisions and check the
# merge-order claim ("this card's branch is based on PR #16, so the gate script
# is present") on the branch the job actually runs from.
set -uo pipefail
WS=/home/sap/.hermes/kanban/workspaces/t_7dd3b960
EV=$WS/evidence
REPO=$WS/repo

echo "### profiles on this host"
hermes profile list 2>&1 | head -20

echo
echo "### actionlint — workflow as it exists on each open PR branch"
mkdir -p "$WS/trees/pr17" "$WS/trees/pr18"
git -C "$REPO" archive origin/feature/t_ea0783c5 | tar -x -C "$WS/trees/pr17"
git -C "$REPO" archive origin/feat/t_527d4720-runner | tar -x -C "$WS/trees/pr18"

echo "-- PR #17 (feature/t_ea0783c5) --"
if [ -f "$WS/trees/pr17/.github/workflows/qa-signoff-audit.yml" ]; then
  actionlint "$WS/trees/pr17/.github/workflows/qa-signoff-audit.yml" 2>&1 || true
else
  echo "file absent"
fi
echo "-- PR #18 (feat/t_527d4720-runner) --"
if [ -f "$WS/trees/pr18/.github/workflows/qa-signoff-audit.yml" ]; then
  actionlint "$WS/trees/pr18/.github/workflows/qa-signoff-audit.yml" 2>&1 || true
else
  echo "file absent"
fi

echo
echo "### workflow's own gate-presence check, replayed against each branch tree"
for tree in pr17 pr18; do
  printf '%s: ' "$tree"
  if [ -f "$WS/trees/$tree/scripts/qa/signoff-gate.mjs" ]; then
    echo "PASS — scripts/qa/signoff-gate.mjs present on the branch"
  else
    echo "FAIL — scripts/qa/signoff-gate.mjs ABSENT -> the job dies at 'Verify the gate script is present'"
  fi
done

echo
echo "### VERDICT marker regex — does it ignore markers inside code spans? (§10 item 5)"
grep -n "VERDICT_MARKER_RE\s*=" -A 6 "$REPO/scripts/qa/signoff-gate.mjs"

echo
echo "### non-default boards present on this host? (§10 item 4)"
ls -la "$HOME/.hermes/kanban/" 2>/dev/null | head -15
