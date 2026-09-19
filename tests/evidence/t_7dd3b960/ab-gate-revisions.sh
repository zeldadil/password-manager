#!/usr/bin/env bash
# A/B the scheduled-audit job's gate revision: master (44e15f9 = PR #24) vs the
# reviewed PR #25 revision (0af4a453) that is actually installed in all 7 profiles.
# Demonstrates whether the CI job, as merged today, reports the same failures.
set -uo pipefail
EV=${EVIDENCE_DIR:-/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence}
REPO=${REPO:-/home/sap/.hermes/kanban/workspaces/t_7dd3b960/repo}
DB=${BOARD:-$HOME/.hermes/kanban.db}

cd "$REPO"

echo "### gate revision under test (master) ==="
sha256sum /tmp/gate-master.mjs

echo
echo "### master-gate audit, default view"
node /tmp/gate-master.mjs audit --db "$DB" --repo "$REPO" > "$EV/audit-master-gate.txt" 2>&1
echo "exit=$?"
node /tmp/gate-master.mjs audit --db "$DB" --repo "$REPO" --json > "$EV/audit-master-gate.json" 2>&1
echo "json exit=$?"

echo
echo "### diff: PR25-gate vs master-gate (default view) — rule-level"
