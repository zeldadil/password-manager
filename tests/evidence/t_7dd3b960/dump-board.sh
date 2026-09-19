#!/usr/bin/env bash
# Item 3 (R7 classification): dump the board's cards so the analysis can compare the
# gate's keyword heuristic against the ADR-002 §5.3 / ADR-005 §9.2 scope lists.
set -uo pipefail
OUT=/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence
mkdir -p "$OUT"
sqlite3 -json "$HOME/.hermes/kanban.db" \
  "SELECT id,title,assignee,status,created_by,created_at,completed_at,COALESCE(body,'') AS body,COALESCE(result,'') AS result FROM tasks ORDER BY created_at" \
  > "$OUT/board-tasks.json"
wc -c "$OUT/board-tasks.json"
sqlite3 -json "$HOME/.hermes/kanban.db" \
  "SELECT task_id,author,substr(COALESCE(body,''),1,4000) AS body,created_at FROM comments ORDER BY task_id,created_at" \
  > "$OUT/board-comments.json"
wc -c "$OUT/board-comments.json"
sqlite3 "$HOME/.hermes/kanban.db" "SELECT COUNT(*) FROM tasks"
