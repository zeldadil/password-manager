#!/usr/bin/env bash
# Orientation probes for t_7dd3b960 (no destructive ops, no inline groups).
set -uo pipefail
cd /home/sap/.hermes/kanban/workspaces/t_7dd3b960/repo

echo "=== diff master vs PR25 : scripts/qa/signoff-gate.mjs ==="
git diff --stat origin/master origin/qa/t_58280940-r8-stale-deferral -- scripts/qa/signoff-gate.mjs
echo
echo "=== full diff master...PR25 (name-status) ==="
git diff --name-status origin/master...origin/qa/t_58280940-r8-stale-deferral
echo
echo "=== installed gate copies (agent-hooks) ==="
find /home/sap/.hermes/profiles -maxdepth 3 -name 'signoff-gate.mjs' -path '*agent-hooks*' -print0 2>/dev/null | xargs -0 sha256sum 2>/dev/null | sort
echo
echo "=== repo PR25 copy sha256 ==="
sha256sum /tmp/gate-pr25.mjs
echo
echo "=== repo master copy sha256 ==="
git show origin/master:scripts/qa/signoff-gate.mjs > /tmp/gate-master.mjs
sha256sum /tmp/gate-master.mjs
echo
echo "=== PR16 copy sha256 ==="
git show origin/feature/t_430aa9a3:scripts/qa/signoff-gate.mjs > /tmp/gate-pr16.mjs
sha256sum /tmp/gate-pr16.mjs
echo
echo "=== node/sqlite3 versions ==="
node --version
sqlite3 --version | head -1
