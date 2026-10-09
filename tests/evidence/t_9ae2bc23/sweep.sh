#!/usr/bin/env bash
# t_9ae2bc23 — criterion 3: exhaustive sweep of every `done` card for a pass that
# depended on a QUOTED (or otherwise refused) qa-signoff-exception key.
#
# Three gate revisions over ONE consistent snapshot of the board:
#   old   = 935b64b  (bd62d76^, pre-fix: any key anywhere = exception)
#   fix   = bd62d76  (t_b8001b55: author allowlist, never securityTrack, code-span aware)
#   head  = origin/master tip at run time (adds R9/R10 etc. — reported, not diffed for A10)
# Views: default (enforced post-epoch) and --strict-history (every done card).
# Then a counterfactual: every exception key neutralised in a SECOND copy, re-run with
# the head gate, to list the cards whose outcome DEPENDS on an applied exception at all
# (the fixed gate only refuses code-span quotes; a plain-text quotation still applies).
#
# The live board is only READ (sqlite3 .backup into $OUT); every write targets a copy.
# Usage: bash sweep.sh <repo-clone> <live-board.db> <outdir>
set -u
REPO="$1"; LIVE="$2"; OUT="$3"
mkdir -p "$OUT"
DB="$OUT/board-snapshot.db"
sqlite3 "$LIVE" ".backup '$DB'"
HEAD_SHA="$(git -C "$REPO" rev-parse origin/master)"
git -C "$REPO" show 935b64b:scripts/qa/signoff-gate.mjs > "$OUT/gate-old.mjs"
git -C "$REPO" show bd62d76:scripts/qa/signoff-gate.mjs > "$OUT/gate-fix.mjs"
git -C "$REPO" show "$HEAD_SHA":scripts/qa/signoff-gate.mjs > "$OUT/gate-head.mjs"
echo "head=$HEAD_SHA" > "$OUT/revisions.txt"
git -C "$REPO" rev-parse 935b64b:scripts/qa/signoff-gate.mjs bd62d76:scripts/qa/signoff-gate.mjs "$HEAD_SHA":scripts/qa/signoff-gate.mjs >> "$OUT/revisions.txt"
git hash-object "$OUT/gate-old.mjs" "$OUT/gate-fix.mjs" "$OUT/gate-head.mjs" >> "$OUT/revisions.txt"
sha256sum "$OUT"/gate-*.mjs "$DB" > "$OUT/inputs.sha256"
echo "done cards in snapshot: $(sqlite3 "$DB" "SELECT count(*) FROM tasks WHERE status='done'")" > "$OUT/board-facts.txt"
echo "comments carrying the key (any card): $(sqlite3 "$DB" "SELECT count(*) FROM task_comments WHERE lower(body) LIKE '%signoff%exception%'")" >> "$OUT/board-facts.txt"
echo "done cards carrying the key: $(sqlite3 "$DB" "SELECT count(DISTINCT c.task_id) FROM task_comments c JOIN tasks t ON t.id=c.task_id WHERE t.status='done' AND lower(c.body) LIKE '%signoff%exception%'")" >> "$OUT/board-facts.txt"

run() {
  # $1 gate, $2 view label, $3 db, $4 extra flag
  env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE -u HERMES_KANBAN_BRANCH \
    node "$OUT/gate-$1.mjs" audit --db "$3" --repo "$REPO" --json $4 > "$OUT/audit-$1-$2.json" 2> "$OUT/audit-$1-$2.stderr"
  echo "gate=$1 view=$2 exit=$?" >> "$OUT/exit-codes.txt"
}
: > "$OUT/exit-codes.txt"
run old default "$DB" ""
run fix default "$DB" ""
run head default "$DB" ""
run old strict "$DB" "--strict-history"
run fix strict "$DB" "--strict-history"
run head strict "$DB" "--strict-history"

CF="$OUT/board-no-exceptions.db"
cp "$DB" "$CF"
echo "counterfactual copy: $(python3 "$(dirname "$0")/neutralise.py" "$CF")" >> "$OUT/board-facts.txt"
run head strict-noexc "$CF" "--strict-history"
run fix strict-noexc "$CF" "--strict-history"

python3 "$(dirname "$0")/analyze.py" "$OUT" "$DB" > "$OUT/analysis.txt"
cat "$OUT/exit-codes.txt" "$OUT/board-facts.txt" "$OUT/analysis.txt"
