#!/usr/bin/env bash
# t_f4daddb9 — read-only board-wide A/B of the unmerged-mention R9 trigger.
# One consistent snapshot of the live board (sqlite3 .backup into OUT, the live
# board is only read), the same GitHub answers for both runs (live `gh`, read
# only, memoised per process), audited with the reference gate (before) and
# with this branch's gate (after), then diffed per card.
# Usage: bash tests/evidence/t_f4daddb9/audit-ab.sh <ref-worktree> <out-dir outside the repo>
set -u
NODE=${NODE:-node}
HERE=$(cd "$(dirname "$0")/../../.." && pwd)
BEFORE=${1:?reference worktree path}
OUT=${2:?output dir (outside the repo)}
LIVE=${QA_AB_BOARD:-$HOME/.hermes/kanban.db}
mkdir -p "$OUT"
SNAP="$OUT/board-snapshot.db"
sqlite3 "$LIVE" ".backup '$SNAP'"
echo "snapshot: $(sqlite3 "$SNAP" 'SELECT COUNT(*) FROM tasks') cards, taken $(date -u +%FT%TZ) from the live board (read only)"
echo "reference gate @ $(git -C "$BEFORE" rev-parse --short HEAD) sha256 $(sha256sum "$BEFORE/scripts/qa/signoff-gate.mjs" | cut -d' ' -f1)"
echo "branch gate    @ $(git -C "$HERE" rev-parse --short HEAD) sha256 $(sha256sum "$HERE/scripts/qa/signoff-gate.mjs" | cut -d' ' -f1)"
export QA_GATE_GH_BUDGET_MS=${QA_GATE_GH_BUDGET_MS:-600000}
run() {
  env -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE -u HERMES_KANBAN_BRANCH -u HERMES_KANBAN_DB \
    $NODE "$1/scripts/qa/signoff-gate.mjs" audit --db "$SNAP" --repo "$1" --gh-repo zeldadil/password-manager --json $3 > "$OUT/$2.json"
  echo "$2 audit exit=$?"
}
run "$BEFORE" audit-before ""
run "$HERE" audit-after ""
run "$BEFORE" audit-before-strict "--strict-history"
run "$HERE" audit-after-strict "--strict-history"
echo
echo "=== default view (epochs applied) ==="
$NODE "$HERE/tests/evidence/t_f4daddb9/audit-diff.mjs" "$OUT/audit-before.json" "$OUT/audit-after.json"
echo
echo "=== --strict-history view (retrofit: grandfathered cards judged too) ==="
$NODE "$HERE/tests/evidence/t_f4daddb9/audit-diff.mjs" "$OUT/audit-before-strict.json" "$OUT/audit-after-strict.json"
