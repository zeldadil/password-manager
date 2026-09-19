#!/bin/bash
# t_d20787de — finalise: read this card's own comment back, capture the T2 board state + audit, simulate the
# completion hook against the workspace, and refresh the bundle (repo copy + workspace mirror).
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
WS=/home/sap/.hermes/kanban/workspaces/t_d20787de
WT=/home/sap/password-manager-check/.worktrees/t_d20787de
EV="$WT/tests/evidence/t_d20787de"
GATE="$WT/scripts/qa/signoff-gate.mjs"
BOARD="${HERMES_KANBAN_DB:-/home/sap/.hermes/kanban.db}"

# 1. read back all seven comments (drafts vs the board's authoritative bodies)
sed -i 's/^for card in t_e348e0b7 t_28951254 t_2162d273 t_527d4720 t_c3cb6842 t_80fc0326; do$/for card in t_e348e0b7 t_28951254 t_2162d273 t_527d4720 t_c3cb6842 t_80fc0326 t_d20787de; do/' "$SCR/readback.sh"
bash "$SCR/readback.sh" > "$SCR/readback-final.txt" 2>&1
cp "$SCR/readback-final.txt" "$EV/comment-readback-diff.txt"
cp "$SCR/readback/t_d20787de.md" "$EV/readback/t_d20787de.md"
cp "$SCR/drafts/t_d20787de.md" "$EV/drafts/t_d20787de.md"

# 2. T2: board state with all seven comments, audit + this card's own check
bash "$SCR/snapshot-board.sh" t2 > "$SCR/snapshot-t2.txt" 2>&1
( cd "$WT" && env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE \
    node scripts/qa/signoff-gate.mjs audit --db "$SCR/board-t2.db" --repo "$WT" ) > "$SCR/audit-t2.txt" 2>&1
echo "audit-t2 exit=$?"

# 3. simulate the completion hook: root = the worker's workspace (not a git repo), pre-complete semantics
( cd "$WS" && env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE \
    node "$GATE" check --task t_d20787de --db "$SCR/board-t2.db" --repo "$WS" --pre-complete ) > "$SCR/hook-simulation.txt" 2>&1

# 4. refresh the bundle
cp "$SCR/audit-t2.txt" "$EV/audit-t2.txt"
cp "$SCR/snapshot-t2.txt" "$EV/transcripts/board-snapshot-t2.txt"
cp "$SCR/hook-simulation.txt" "$EV/transcripts/completion-hook-simulation.txt"
cp "$SCR/board-t2.db" /dev/null 2>/dev/null || true   # never copy a board into the bundle
{
  echo "=== T2 (all seven comments present) ==="
  grep -E "^  enforced" "$SCR/audit-t2.txt"
  echo
  echo "=== per-card before/after/final ==="
  for card in t_e348e0b7 t_28951254 t_2162d273 t_527d4720 t_80fc0326 t_c3cb6842 t_d20787de t_7918f010 t_b51a1ff3; do
    b=$(awk -v c="$card" '$0 ~ "^  FAIL "c" " || $0 ~ "^  ok   "c" " {print $1}' "$SCR/audit-t0.txt" | head -1)
    a=$(awk -v c="$card" '$0 ~ "^  FAIL "c" " || $0 ~ "^  ok   "c" " {print $1}' "$SCR/audit-t1.txt" | head -1)
    f=$(awk -v c="$card" '$0 ~ "^  FAIL "c" " || $0 ~ "^  ok   "c" " {print $1}' "$SCR/audit-t2.txt" | head -1)
    echo "  $card  t0=${b:-(not enforced)}  t1=${a:-(not enforced)}  t2=${f:-(not enforced)}"
  done
} > "$SCR/final-summary.txt"
cat "$SCR/final-summary.txt"
echo
echo "=== this card's own compliance check (workspace as root, pre-complete) ==="
cat "$SCR/hook-simulation.txt"

# 5. re-mirror into the workspace
bash "$SCR/mirror-evidence.sh" 2>&1 | tail -12
echo
echo "=== bundle self-check ==="
grep -r -l -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$EV" | wc -l
