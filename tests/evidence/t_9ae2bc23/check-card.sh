#!/usr/bin/env bash
# t_9ae2bc23 — gate check on one card with the origin/master gate, live board (read-only),
# from this clone. Usage: bash check-card.sh <card> <outfile>
set -u
REPO="$(git rev-parse --show-toplevel)"
env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE -u HERMES_KANBAN_BRANCH \
  node "$REPO/scripts/qa/signoff-gate.mjs" check --task "$1" --db /home/sap/.hermes/kanban.db --repo "$REPO" --json > "$2.json"
code=$?
python3 "$(dirname "$0")/summarise-check.py" "$2.json" "$code" > "$2"
cat "$2"
