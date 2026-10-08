#!/usr/bin/env bash
# t_7e8bf917 — RED proof: run this branch's selftest against the origin/master
# gate (copied next to the master gate, removed afterwards).
# Usage: bash tests/evidence/t_7e8bf917/selftest-red.sh <master-worktree> > selftest-red.txt
set -u
NODE=${NODE:-node}
HERE=$(cd "$(dirname "$0")/../../.." && pwd)
MASTER=${1:?master worktree path}
TMP="$MASTER/scripts/qa/red.selftest.mjs"
cp "$HERE/scripts/qa/signoff-gate.selftest.mjs" "$TMP"
echo "# RED: branch selftest vs origin/master gate @ $(git -C "$MASTER" rev-parse --short HEAD), node $($NODE --version)"
$NODE "$TMP"
echo "# selftest exit=$?"
rm -f "$TMP"
