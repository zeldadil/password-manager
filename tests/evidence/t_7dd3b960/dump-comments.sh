#!/usr/bin/env bash
set -uo pipefail
OUT=/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence
sqlite3 -json "$HOME/.hermes/kanban.db" \
  "SELECT task_id,author,substr(COALESCE(body,''),1,6000) AS body,created_at FROM task_comments ORDER BY task_id,created_at" \
  > "$OUT/board-comments.json"
wc -c "$OUT/board-comments.json"
sqlite3 "$HOME/.hermes/kanban.db" "SELECT COUNT(*) FROM task_comments"
