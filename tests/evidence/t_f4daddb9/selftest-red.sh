#!/usr/bin/env bash
# t_f4daddb9 — RED/GREEN proof for the unmerged-mention R9 trigger.
# RED  : this branch's selftest run against the gate of a reference commit
#        (default b1db88f, the master the card reproduced on), copied next to
#        that gate in a detached worktree, removed afterwards.
# GREEN: the same selftest against this branch's gate.
# Usage: bash tests/evidence/t_f4daddb9/selftest-red.sh <ref-worktree> > selftest-red.txt
# Read-only: no board, no network (GitHub answers come from fixtures).
set -u
NODE=${NODE:-node}
HERE=$(cd "$(dirname "$0")/../../.." && pwd)
REF=${1:?reference worktree path (detached checkout of b1db88f or origin/master)}
TMP="$REF/scripts/qa/red-t_f4daddb9.selftest.mjs"
cp "$HERE/scripts/qa/signoff-gate.selftest.mjs" "$TMP"
echo "# RED: branch selftest vs reference gate @ $(git -C "$REF" rev-parse --short HEAD), node $($NODE --version)"
echo "# reference gate sha256: $(sha256sum "$REF/scripts/qa/signoff-gate.mjs" | cut -d' ' -f1)"
echo "# branch gate sha256:    $(sha256sum "$HERE/scripts/qa/signoff-gate.mjs" | cut -d' ' -f1)"
env -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE -u HERMES_KANBAN_BRANCH -u HERMES_KANBAN_DB $NODE "$TMP"
echo "# RED selftest exit=$?"
rm -f "$TMP"
