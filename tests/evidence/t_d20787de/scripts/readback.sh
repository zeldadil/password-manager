#!/bin/bash
# t_d20787de — read the recorded comments BACK OUT of the live board and compare them byte-for-byte
# with the drafts (a long comment carried inline can be normalised on the way in).
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
RB="$SCR/readback"
mkdir -p "$RB"
: > "$SCR/readback-diff.txt"
for card in t_e348e0b7 t_28951254 t_2162d273 t_527d4720 t_c3cb6842 t_80fc0326; do
  id=$(sqlite3 -- "$HERMES_KANBAN_DB" "SELECT id FROM task_comments WHERE task_id='$card' AND author='qa' ORDER BY created_at DESC, id DESC LIMIT 1;")
  sqlite3 -- "$HERMES_KANBAN_DB" "SELECT body FROM task_comments WHERE id=$id;" > "$RB/$card.md"
  {
    echo "================================================================================"
    echo "CARD $card  comment_id=$id  author=$(sqlite3 -- "$HERMES_KANBAN_DB" "SELECT author FROM task_comments WHERE id=$id;")  at=$(sqlite3 -- "$HERMES_KANBAN_DB" "SELECT datetime(created_at,'unixepoch') FROM task_comments WHERE id=$id;")"
    echo "draft bytes=$(wc -c < "$SCR/drafts/$card.md")  board bytes=$(wc -c < "$RB/$card.md")"
    if cmp -s "$SCR/drafts/$card.md" "$RB/$card.md"; then
      echo "cmp: IDENTICAL"
    else
      echo "cmp: DIFFERS"
      diff -u "$SCR/drafts/$card.md" "$RB/$card.md" | head -40
    fi
  } >> "$SCR/readback-diff.txt"
done
cat "$SCR/readback-diff.txt"
