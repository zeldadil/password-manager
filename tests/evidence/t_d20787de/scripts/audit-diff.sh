#!/bin/bash
# t_d20787de — T1/T2 audit + before/after failure-set diff (board copies only; the live board is read-only).
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
REPO=/home/sap/password-manager-check/.worktrees/t_d20787de
CD=/home/sap/password-manager-check

# fresh refs before measuring, so the before/after pair sees one ref set
git -C "$CD" fetch --all --prune >/dev/null 2>&1
REFSTATE="refs=$(git -C "$CD" rev-list --all | wc -l) master=$(git -C "$CD" rev-parse --short origin/master)"

audit() {
  local board="$1" tag="$2"
  ( cd "$REPO" && env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE \
      node scripts/qa/signoff-gate.mjs audit --db "$board" --repo "$REPO" ) > "$SCR/audit-$tag.txt" 2>&1
  echo "audit-$tag exit=$?"
}

bash "$SCR/snapshot-board.sh" t1 > "$SCR/snapshot-t1.txt" 2>&1
audit "$SCR/board-t0.db" t0
audit "$SCR/board-t1.db" t1

{
  echo "gate:      $(sha256sum "$REPO/scripts/qa/signoff-gate.mjs" | cut -d' ' -f1)"
  echo "ref state: $REFSTATE"
  echo "t0 board:  $(sha256sum "$SCR/board-t0.db" | cut -d' ' -f1)  ($(sqlite3 -- "$SCR/board-t0.db" 'select count(*) from task_comments;') comments)"
  echo "t1 board:  $(sha256sum "$SCR/board-t1.db" | cut -d' ' -f1)  ($(sqlite3 -- "$SCR/board-t1.db" 'select count(*) from task_comments;') comments)"
  echo
  echo "=== per-card violation sets ==="
  for card in t_e348e0b7 t_28951254 t_2162d273 t_527d4720 t_80fc0326 t_c3cb6842 t_28f60dc1 t_7918f010 t_b51a1ff3; do
    b=$(awk -v c="$card" '$0 ~ "FAIL "c" " || $0 ~ "ok   "c" " {print}' "$SCR/audit-t0.txt" | head -1 | awk '{print $1}')
    a=$(awk -v c="$card" '$0 ~ "FAIL "c" " || $0 ~ "ok   "c" " {print}' "$SCR/audit-t1.txt" | head -1 | awk '{print $1}')
    [ -z "$b" ] && b="(not enforced)"
    [ -z "$a" ] && a="(not enforced)"
    echo "  $card  before=$b  after=$a"
  done
  echo
  echo "=== summary line, before vs after ==="
  grep -E "^  enforced" "$SCR/audit-t0.txt" | sed 's/^/  t0 /'
  grep -E "^  enforced" "$SCR/audit-t1.txt" | sed 's/^/  t1 /'
  echo
  echo "=== diff of FAIL sets (rule lines only) ==="
  diff <(grep -E "^  FAIL|^        R" "$SCR/audit-t0.txt") <(grep -E "^  FAIL|^        R" "$SCR/audit-t1.txt") || true
} > "$SCR/audit-diff.txt" 2>&1
cat "$SCR/audit-diff.txt"
