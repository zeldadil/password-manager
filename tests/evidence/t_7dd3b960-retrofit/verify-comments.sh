#!/usr/bin/env bash
# Verify: (a) the 6 comments were stored byte-identically to the authored files,
# (b) they are authored by the qa profile, (c) capture the stored bodies as evidence.
set -uo pipefail
DB="$HOME/.hermes/kanban.db"
SRC=/home/sap/qa-retrofit-work/comments
OUT=/home/sap/qa-retrofit-work/stored
mkdir -p "$OUT"
rc=0
for id in t_9840ccdd t_3ca45da2 t_08b02da9 t_ac6a1f3f t_a2cf1744 t_5fe41426; do
  # newest comment on the card, taken from the board itself
  sqlite3 -- "$DB" "SELECT body FROM task_comments WHERE task_id='$id' ORDER BY created_at DESC, id DESC LIMIT 1;" > "$OUT/$id.md"
  author=$(sqlite3 -- "$DB" "SELECT author FROM task_comments WHERE task_id='$id' ORDER BY created_at DESC, id DESC LIMIT 1;")
  cid=$(sqlite3 -- "$DB" "SELECT id FROM task_comments WHERE task_id='$id' ORDER BY created_at DESC, id DESC LIMIT 1;")
  created=$(sqlite3 -- "$DB" "SELECT datetime(created_at,'unixepoch') FROM task_comments WHERE task_id='$id' ORDER BY created_at DESC, id DESC LIMIT 1;")
  same=$(cmp -s "$SRC/$id.md" "$OUT/$id.md" && echo IDENTICAL || echo DIFFERS)
  verdict_line=$(head -1 "$OUT/$id.md" | cut -c1-60)
  printf '%-12s comment_id=%-4s author=%-6s at=%s  body=%s  head="%s"\n' "$id" "$cid" "$author" "$created" "$same" "$verdict_line"
  [ "$same" = IDENTICAL ] || rc=1
  [ "$author" = "qa" ] || rc=1
done
echo "verification rc=$rc (0 = all identical + authored by qa)"
exit $rc
