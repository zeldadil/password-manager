#!/bin/bash
# t_d20787de — dump the cards under review from a board copy (read only).
set -u
DB="${1:?usage: dump-cards.sh <board.db>}"
CARDS="t_e348e0b7 t_28951254 t_2162d273 t_527d4720 t_80fc0326 t_c3cb6842 t_28f60dc1"
echo "board: $DB"
echo "dumped_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
for c in $CARDS; do
  echo "================================================================================"
  echo "CARD $c"
  echo "================================================================================"
  sqlite3 -line -- "$DB" "SELECT id,title,assignee,status,priority,created_at,started_at,completed_at,length(COALESCE(result,'')) AS result_len FROM tasks WHERE id='$c';"
  echo "--- comments (oldest first: id, author, utc, len) ---"
  sqlite3 -- "$DB" "SELECT id||' | '||author||' | '||datetime(created_at,'unixepoch')||' | '||length(body) FROM task_comments WHERE task_id='$c' ORDER BY created_at ASC, id ASC;"
  echo "--- attachments ---"
  sqlite3 -- "$DB" "SELECT id||' | '||filename||' | '||size FROM task_attachments WHERE task_id='$c';"
  echo "--- runs (newest first: id, profile, status, outcome, has verdict-metadata keys) ---"
  sqlite3 -- "$DB" "SELECT id||' | '||profile||' | '||status||' | '||COALESCE(outcome,'-')||' | '||CASE WHEN metadata LIKE '%\"verdict"%' OR metadata LIKE '%\"qa_verdict\"%' OR metadata LIKE '%\"qaVerdict\"%' THEN 'HAS-VERDICT-KEY' ELSE '-' END FROM task_runs WHERE task_id='$c' ORDER BY id DESC;"
  echo "--- dependency edges ---"
  sqlite3 -- "$DB" "SELECT 'parent='||parent_id FROM task_links WHERE child_id='$c' UNION ALL SELECT 'child='||child_id FROM task_links WHERE parent_id='$c';"
  echo
done
