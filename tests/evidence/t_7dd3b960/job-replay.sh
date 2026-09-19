#!/usr/bin/env bash
# Item 1 — replay the scheduled audit job's environment assumptions.
# actions/checkout@v4 defaults to fetch-depth: 1 (single ref). The gate's
# off-tree evidence lookup (A4) uses `git rev-list --all`, so a shallow checkout
# changes the audit's verdict. Prove it with the real board, no fabrication.
set -uo pipefail
WS=${WORKSPACE:-/home/sap/.hermes/kanban/workspaces/t_7dd3b960}
EV=${EVIDENCE_DIR:-$WS/evidence}
DB=${BOARD:-$HOME/.hermes/kanban.db}
REPO=${REPO:-$WS/repo}
GATE=${GATE:-$EV/gate-pr25.mjs}
mkdir -p "$EV"

echo "### scenario A — full checkout (all refs), PR25 gate"
node "$GATE" audit --db "$DB" --repo "$REPO" --json > "$EV/job-A-full-clone.json" 2>&1
echo "exit=$?"

echo
echo "### scenario B — actions/checkout@v4 default (fetch-depth: 1, single ref)"
rm -rf "$WS/shallow" 2>/dev/null || true
git clone --quiet --depth 1 --single-branch --branch master https://github.com/zeldadil/password-manager.git "$WS/shallow"
node "$GATE" audit --db "$DB" --repo "$WS/shallow" --json > "$EV/job-B-shallow-clone.json" 2>&1
echo "exit=$?"

echo
echo "### scenario C — board missing (runner has no ~/.hermes/kanban.db)"
# mirrors the workflow's resolve step: none of the three candidates exists
env HOME=/nonexistent-home HERMES_KANBAN_DB= node "$GATE" audit --repo "$REPO" > "$EV/job-C-no-board.txt" 2>&1
echo "exit=$?"
head -3 "$EV/job-C-no-board.txt"
