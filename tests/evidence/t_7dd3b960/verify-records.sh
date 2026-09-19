#!/usr/bin/env bash
# Verify the two claims the architect card t_33dcad7d made about durable records:
#   (a) "Decision recorded in PROJECT_BRIEF.md §9" (pre-epoch grandfathering)
#   (b) "Evidence attached: docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md"
set -uo pipefail
REPO=/home/sap/.hermes/kanban/workspaces/t_7dd3b960/repo
cd "$REPO"

echo "### (a) any commit touching that decision doc, on ANY ref"
git log --all --oneline -- docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md | head
echo "(empty above = never committed)"
git rev-list --all -- docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md | head
echo "--- tests/evidence/t_33dcad7d on any ref ---"
git rev-list --all -- tests/evidence/t_33dcad7d/ | head
echo "--- grep the doc name across all commits ---"
git grep -l "qa-signoff-gate-followups-t_33dcad7d" $(git rev-list --all) -- 2>/dev/null | head -5

echo
echo "### (b) PROJECT_BRIEF.md on master: §9 / grandfathering text"
git show origin/master:PROJECT_BRIEF.md > /tmp/brief-master.md
grep -n "^## \|^# " /tmp/brief-master.md
echo "--- lines mentioning grandfathered/pre-epoch/gate ---"
grep -n -i "grandfather\|pre-epoch\|sign-off gate\|signoff" /tmp/brief-master.md | head -20

echo
echo "### (c) is the decision doc on the remote at all (name search, all refs)?"
git grep -l "docs/decisions" origin/master -- 2>/dev/null | head -5
echo "--- docs/decisions on master ---"
git ls-tree -r --name-only origin/master | grep -i "docs/" | head -20
