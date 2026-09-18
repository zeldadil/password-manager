#!/bin/bash
# Collect the scope/identity facts the round-2 verdict rests on.
set -uo pipefail
QA=/home/sap/.hermes/kanban/workspaces/t_4e1b6937/qa_r2
cd "$QA/pm"
echo "### clone HEAD"
git rev-parse HEAD
git log --oneline -2
echo
echo "### remote branch head (fetched now)"
git fetch --quiet origin feature/t_4e1b6937
git rev-parse origin/feature/t_4e1b6937
echo
echo "### working tree status"
git status --porcelain || true
echo
echo "### diff stat 9709272..823d7ab (round-1 reviewed head -> round-2 head)"
git diff --stat 9709272 823d7ab
echo
echo "### implementation files changed 9709272..823d7ab"
git diff --name-only 9709272 823d7ab | grep -v '\.test\.' || echo "(none)"
echo
echo "### sha256 of the reviewed artifact + attachments"
cd "$QA/pm"
sha256sum apps/web/src/api/envelope.test.ts tests/evidence/t_4e1b6937/README.md tests/evidence/t_4e1b6937/d1_sensitivity.py
sha256sum /home/sap/.hermes/kanban/attachments/t_4e1b6937/README_1.md /home/sap/.hermes/kanban/attachments/t_4e1b6937/d1_sensitivity.py
echo
echo "### hygiene greps"
echo "-- .only/.skip/.todo in apps/web/src (excluding css class names):"
grep -rn "\.only(\|\.skip(\|\.todo(" apps/web/src || echo "   none"
echo "-- console/localStorage/sessionStorage/cookie in the changed spec:"
grep -n "console\.\|localStorage\|sessionStorage\|document\.cookie" apps/web/src/api/envelope.test.ts || echo "   none"
echo
echo "### gitleaks (source tree incl. new harness)"
gitleaks detect --no-git --redact --source . 2>&1 | tail -3
