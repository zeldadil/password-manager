#!/usr/bin/env bash
# t_7e8bf917 AC4 — live, read-only replay of the gate on t_75180b28 (and the
# other cards of the same session) with the master gate (before) and this
# branch's gate (after). Reads the live board and GitHub through `gh`; writes
# nothing to either. Usage: bash tests/evidence/t_7e8bf917/live-check.sh <master-worktree>
set -u
NODE=${NODE:-node}
HERE=$(cd "$(dirname "$0")/../../.." && pwd)
BEFORE=${1:?master worktree path}
DB=${HERMES_KANBAN_DB:-$HOME/.hermes/kanban.db}
echo "# date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# node: $($NODE --version)"
echo "# after  = $(git -C "$HERE" rev-parse --abbrev-ref HEAD) @ $(git -C "$HERE" rev-parse --short HEAD) (+ working tree)"
echo "# before = $(git -C "$BEFORE" rev-parse --short HEAD) (origin/master)"
echo "# board  = $DB (read-only)"
for T in t_75180b28 t_b8001b55 t_7e8bf917; do
  for SIDE in before after; do
    if [ "$SIDE" = before ]; then ROOT=$BEFORE; else ROOT=$HERE; fi
    echo
    echo "## $T — $SIDE"
    $NODE "$ROOT/scripts/qa/signoff-gate.mjs" check --task "$T" --pre-complete --db "$DB" --repo "$ROOT" --json \
      | $NODE "$HERE/tests/evidence/t_7e8bf917/summarize-pr-rule.mjs"
  done
done
