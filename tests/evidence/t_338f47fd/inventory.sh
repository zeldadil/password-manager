#!/usr/bin/env bash
# t_338f47fd — inventory of every verdict source on the live board, by author,
# under BOTH gate revisions. Read-only (the board is copied); writes the committed
# transcript tests/evidence/t_338f47fd/non-qa-marker-inventory.txt.
#
# Usage: bash tests/evidence/t_338f47fd/inventory.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
BOARD="${HERMES_KANBAN_DB:-${HOME}/.hermes/kanban.db}"
GATE="${REPO_ROOT}/scripts/qa/signoff-gate.mjs"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/t_338f47fd-inv.XXXXXX")"
cp "$BOARD" "$WORK/board.db"
# The pre-fix revision (28b0b771…, the PR #29 head this branch was cut from),
# read from git so the before/after inventory needs no committed copy of the old logic.
PREFIX_REF="${PREFIX_REF:-4c0d3ea}"
git -C "$REPO_ROOT" show "${PREFIX_REF}:scripts/qa/signoff-gate.mjs" > "$WORK/prefix-gate.mjs"
sha() { sha256sum "$1" | cut -d' ' -f1; }
{
  echo "t_338f47fd — every verdict source the gate sees, by author (board copy, read-only)"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "board copy: $WORK/board.db sha256 $(sha "$WORK/board.db")  (copy of $BOARD)"
  echo
  echo "======================================================================"
  echo "BEFORE — prefix gate $WORK/prefix-gate.mjs sha256 $(sha "$WORK/prefix-gate.mjs")"
  echo "(the marker path accepted ANY author, so these comment sources were verdicts)"
  echo "======================================================================"
  node "$HERE/inventory-verdict-sources.mjs" "$WORK/prefix-gate.mjs" "$WORK/board.db" 2>&1 | tail -32
  echo
  echo "======================================================================"
  echo "AFTER — fixed gate $GATE sha256 $(sha "$GATE")"
  echo "======================================================================"
  node "$HERE/inventory-verdict-sources.mjs" "$GATE" "$WORK/board.db" 2>&1 | tail -32
} > "$HERE/non-qa-marker-inventory.txt" 2>&1
grep -c "marker-comment" "$HERE/non-qa-marker-inventory.txt" >/dev/null
sed -n '1,12p' "$HERE/non-qa-marker-inventory.txt"
echo "..."
grep -n "count:\|non-QA \*valid\*\|OPERATIVE-NON-QA" "$HERE/non-qa-marker-inventory.txt"
rm -rf "$WORK"
