#!/usr/bin/env bash
# Live-board audit delta: master gate vs branch gate (t_b2588ee7). Read-only on kanban.db.
set -u
W=/home/sap/.hermes/kanban/workspaces/t_b2588ee7
N=/home/sap/.hermes/profiles/qa/cache/scratch/node22/node-v22.23.3-linux-x64/bin/node
SNAP=$W/board-snapshot.db
sqlite3 /home/sap/.hermes/kanban.db ".backup '$SNAP'"
cd $W/repo
cp $W/gate-master.mjs scripts/qa/signoff-gate.mjs
$N scripts/qa/signoff-gate.mjs audit --db "$SNAP" --repo . --no-github --json-out $W/audit-master.json > $W/audit-master.txt 2>&1
echo "master rc=$?"
cp $W/gate-branch.mjs scripts/qa/signoff-gate.mjs
$N scripts/qa/signoff-gate.mjs audit --db "$SNAP" --repo . --no-github --json-out $W/audit-branch.json > $W/audit-branch.txt 2>&1
echo "branch rc=$?"
cmp -s $W/gate-branch.mjs scripts/qa/signoff-gate.mjs && echo "branch gate restored"
