#!/usr/bin/env bash
# Pre-epoch backlog audit (QA-001i §10 item 2) — real board, newest reviewed gate.
#
# Gate under test: scripts/qa/signoff-gate.mjs as it exists on the PR #25 branch
# (sha256 0af4a453...), which is the copy installed in all 7 profiles.
# The gate is used from a scratch path: it is NOT written into the repo worktree,
# so running this script leaves the checkout clean.
#
# Usage:
#   GATE=<gate .mjs> REPO=<full clone> BOARD=<board db> EVIDENCE_DIR=<out> bash run-pre-epoch-audit.sh
set -uo pipefail

REPO=${REPO:-/home/sap/.hermes/kanban/workspaces/t_7dd3b960/repo}
EV=${EVIDENCE_DIR:-/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence}
DB=${BOARD:-$HOME/.hermes/kanban.db}
GATE=${GATE:-/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence/gate-pr25.mjs}
mkdir -p "$EV"

cd "$REPO"

echo "### gate identity"
grep -n 'GATE_EPOCH_ISO' "$GATE" | head -2
sha256sum "$GATE"
echo "### repo HEAD: $(git rev-parse --short HEAD)  (working tree must stay clean)"

echo
echo "### A) default audit (enforced view)"
node "$GATE" audit --db "$DB" --repo "$REPO" 2>&1 | tee "$EV/audit-default.txt" | tail -25
echo "exit(default)=${PIPESTATUS[0]}"

echo
echo "### B) --strict-history audit (retrofit view)"
node "$GATE" audit --db "$DB" --repo "$REPO" --strict-history 2>&1 | tee "$EV/audit-strict-history.txt" | tail -40
echo "exit(strict)=${PIPESTATUS[0]}"

echo
echo "### C) JSON (strict-history) for machine analysis"
node "$GATE" audit --db "$DB" --repo "$REPO" --strict-history --json > "$EV/audit-strict-history.json" 2>"$EV/audit-strict-history.err"
echo "exit(json)=$?"
wc -c "$EV/audit-strict-history.json"

echo
echo "### D) JSON (default) for machine analysis"
node "$GATE" audit --db "$DB" --repo "$REPO" --json > "$EV/audit-default.json" 2>&1
echo "exit(json-default)=$?"

echo
echo "### working tree check (must print nothing)"
git status --porcelain
