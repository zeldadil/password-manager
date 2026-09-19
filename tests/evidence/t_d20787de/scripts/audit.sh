#!/bin/bash
# t_d20787de — run the installed/reviewed gate over a board copy. Read-only on the live board.
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
REPO="${REPO:-/home/sap/password-manager-check/.worktrees/t_d20787de}"
BOARD="${1:?usage: audit.sh <board.db> <tag>}"
TAG="${2:?usage: audit.sh <board.db> <tag>}"
OUT="$SCR/audit-$TAG.txt"
cd "$REPO" || exit 1
{
  echo "gate:  $(sha256sum scripts/qa/signoff-gate.mjs)"
  echo "board: $BOARD sha256 $(sha256sum "$BOARD" | cut -d' ' -f1)"
  echo "repo:  $PWD head=$(git rev-parse HEAD) refs=$(git rev-list --all | wc -l)"
  echo "date:  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE \
    node scripts/qa/signoff-gate.mjs audit --db "$BOARD" --repo "$PWD"
  echo "audit exit: $?"
} | tee "$OUT"
