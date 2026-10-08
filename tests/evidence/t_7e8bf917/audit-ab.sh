#!/usr/bin/env bash
# t_7e8bf917 — read-only board-wide A/B of the §5.9 linking change: the live
# audit run with the master gate and with this branch's gate, then diffed.
# Usage: bash tests/evidence/t_7e8bf917/audit-ab.sh <master-worktree> <out-dir>
set -u
NODE=${NODE:-node}
HERE=$(cd "$(dirname "$0")/../../.." && pwd)
BEFORE=${1:?master worktree path}
OUT=${2:?output dir (outside the repo)}
DB=${HERMES_KANBAN_DB:-$HOME/.hermes/kanban.db}
mkdir -p "$OUT"
$NODE "$BEFORE/scripts/qa/signoff-gate.mjs" audit --db "$DB" --repo "$BEFORE" --json > "$OUT/audit-before.json"
echo "before audit exit=$?"
$NODE "$HERE/scripts/qa/signoff-gate.mjs" audit --db "$DB" --repo "$HERE" --json > "$OUT/audit-after.json"
echo "after audit exit=$?"
$NODE "$HERE/tests/evidence/t_7e8bf917/audit-diff.mjs" "$OUT/audit-before.json" "$OUT/audit-after.json"
