#!/usr/bin/env bash
# t_338f47fd — dogfood: the gate's verdict on THIS card, and the real hook path for
# this card's own completion (which is what actually guards it).
#
# The worker's cwd is its scratch workspace, so the hook resolves repo-relative
# evidence paths against that directory: the committed evidence is mirrored into
# `<workspace>/tests/evidence/t_338f47fd/` (byte-compared below) before the fire.
#
# Usage: bash tests/evidence/t_338f47fd/dogfood.sh [--fire]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
CARD="${CARD:-t_338f47fd}"
BOARD="${HERMES_KANBAN_DB:-${HOME}/.hermes/kanban.db}"
WORKSPACE="${HERMES_KANBAN_WORKSPACE:-$(pwd)}"
FIRE=0
[ "${1:-}" = "--fire" ] && FIRE=1

cd "$REPO_ROOT"

# gate verdict on this card (pre-complete: the card is still running)
{
  echo "t_338f47fd — gate verdict on this card before it is completed (dogfood)"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "command: node scripts/qa/signoff-gate.mjs check --task $CARD --pre-complete --repo $REPO_ROOT"
  echo
  node scripts/qa/signoff-gate.mjs check --task "$CARD" --pre-complete --repo "$REPO_ROOT" 2>&1
  echo "exit: $?"
} > "$HERE/dogfood-after-verdict.txt" 2>&1

if [ "$FIRE" -eq 1 ]; then
  payload="$(mktemp)"
  printf '{"args":{"task_id":"%s","summary":"own-completion live fire"},"task_id":"%s"}\n' "$CARD" "$CARD" > "$payload"
  {
    echo "t_338f47fd — live fire of the INSTALLED hook for this card's own completion"
    echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "cwd:   $WORKSPACE   (the hook resolves evidence paths against this directory)"
    echo "board: $BOARD"
    echo "evidence mirror: $WORKSPACE/tests/evidence/$CARD/"
    echo
    echo "── mirror check (committed copy vs workspace mirror)"
    diff -r "$REPO_ROOT/tests/evidence/$CARD" "$WORKSPACE/tests/evidence/$CARD" >/dev/null 2>&1 \
      && echo "   identical: $(cd "$REPO_ROOT/tests/evidence/$CARD" && find . -type f | wc -l) files" \
      || echo "   DIFFERS — re-copy before relying on the fire"
    echo
    echo "── fire: hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file <payload>"
    ( cd "$WORKSPACE" && HERMES_HOME="${HERMES_PROFILES_ROOT:-$HOME/.hermes/profiles}/qa" HERMES_KANBAN_DB="$BOARD" \
        hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file "$payload" 2>&1 )
  } > "$HERE/own-completion-live-fire.txt" 2>&1
  rm -f "$payload"
  tail -12 "$HERE/own-completion-live-fire.txt"
fi

tail -4 "$HERE/dogfood-after-verdict.txt"
