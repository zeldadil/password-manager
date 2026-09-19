#!/bin/bash
# t_d20787de — snapshot the LIVE board (read-only copy) and dump the cards under review.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_d20787de
SCR="$WS/scratch"
LIVE="${HERMES_KANBAN_DB:-/home/sap/.hermes/kanban.db}"
TAG="${1:?usage: snapshot-board.sh <tag>}"
OUT="$SCR/board-$TAG.db"
mkdir -p "$SCR"

# sqlite3 .backup is a consistent read of a live WAL db — never touches the source rows.
sqlite3 -- "$LIVE" ".backup '$OUT'"
echo "live board: $LIVE"
echo "copy:       $OUT"
echo "sha256:     $(sha256sum "$OUT" | cut -d' ' -f1)"
echo "taken_at:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "rows: tasks=$(sqlite3 -- "$OUT" 'select count(*) from tasks;') comments=$(sqlite3 -- "$OUT" 'select count(*) from task_comments;') runs=$(sqlite3 -- "$OUT" 'select count(*) from task_runs;')"
