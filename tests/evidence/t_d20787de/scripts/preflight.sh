#!/bin/bash
# t_d20787de — PRE-FLIGHT on a board copy: replay each drafted comment as a qa-authored, newest record
# and re-evaluate the card with the real gate. The live board is never touched.
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
GATE=/home/sap/password-manager-check/.worktrees/t_d20787de
TESTDB="$SCR/board-preflight.db"
OUT="$SCR/preflight.txt"
cp "$SCR/board-t0.db" "$TESTDB"

{
echo "gate under test: $(sha256sum "$GATE/scripts/qa/signoff-gate.mjs")"
echo "board copy:      $TESTDB (from board-t0.db)"
echo "date:            $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
for card in t_e348e0b7 t_28951254 t_2162d273 t_527d4720 t_c3cb6842 t_80fc0326; do
  body="$SCR/drafts/$card.md"
  ts=$(sqlite3 -- "$TESTDB" "SELECT COALESCE(MAX(created_at),0)+1 FROM task_comments;")
  sqlite3 -- "$TESTDB" "INSERT INTO task_comments (task_id, author, body, created_at) VALUES ('$card', 'qa', readfile('$body'), $ts);"
  echo "==================== $card (comment replayed as qa @ $ts) ===================="
  ( cd "$GATE" && env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE \
      node scripts/qa/signoff-gate.mjs check --task "$card" --db "$TESTDB" --repo "$PWD" ) 2>&1 | sed -n '1,40p'
  echo
done
} 2>&1 | tee "$OUT"
