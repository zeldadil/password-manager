#!/usr/bin/env bash
# reproduce.sh — re-run the QA-001i-fu1 pre-epoch retrofit verification.
#
# Requires: a FULL clone of zeldadil/password-manager (all refs), the live board
# at $HERMES_KANBAN_DB (or ~/.hermes/kanban.db), the reviewed gate revision
# (sha256 0af4a453…), node and the sqlite3 CLI.
#
#   REPO=/path/to/full-clone GATE=/path/to/gate-pr25.mjs bash reproduce.sh
#
# The *before* audit in ./audit/ is a captured point-in-time artefact: the board
# is shared and other workers keep completing cards, so it cannot be re-produced
# verbatim. What this script re-establishes is the *after* state: the 6 retrofit
# cards carry a verdict + committed evidence, no pre-epoch card newly fails, and
# the post-epoch failure set is unchanged.
set -uo pipefail
REPO="${REPO:-/home/sap/qa-retrofit-clone}"
GATE="${GATE:-/home/sap/qa-retrofit-work/bin/gate-pr25.mjs}"
DB="${HERMES_KANBAN_DB:-$HOME/.hermes/kanban.db}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mktemp -d)"
rc=0

echo "### inputs"
echo "repo : $REPO  ($(git -C "$REPO" rev-parse HEAD 2>/dev/null))"
echo "gate : $GATE"
echo "board: $DB  (sha256 $(sha256sum "$DB" | cut -d' ' -f1))"
echo "gate sha256: $(sha256sum "$GATE" | cut -d' ' -f1)"
echo "expected   : 0af4a45363280c134b19662840d04e43d6214b98fca278ec75efe2f824cc8d55"
[ "$(sha256sum "$GATE" | cut -d' ' -f1)" = "0af4a45363280c134b19662840d04e43d6214b98fca278ec75efe2f824cc8d55" ] \
  || { echo "*** gate revision differs — results are not comparable ***"; rc=1; }

echo
echo "### after-audit (--strict-history, live board)"
node "$GATE" audit --db "$DB" --repo "$REPO" --strict-history --json > "$OUT/after-strict.json"
node "$HERE/compare.mjs" "$HERE/audit/before-strict.json" "$OUT/after-strict.json"
echo "  (reported 'cards new to the done-audit' are other workers' cards completed after the"
echo "   capture; the block only needs 0 newly-failing pre-epoch cards)"

echo
echo "### post-epoch view (the enforced one)"
node "$GATE" audit --db "$DB" --repo "$REPO" --json > "$OUT/after-default.json"
node "$HERE/compare.mjs" "$HERE/audit/before-default.json" "$OUT/after-default.json"

echo
echo "### the 6 retrofit cards (verdict + committed evidence)"
node "$HERE/analyze2.mjs" "$OUT/after-strict.json" \
  t_9840ccdd t_3ca45da2 t_08b02da9 t_ac6a1f3f t_a2cf1744 t_5fe41426 \
  | grep -E "^  (t_| *FAIL)" || true

echo
echo "### criterion 2 — every operative evidence path resolves on a ref"
REPO="$REPO" bash "$HERE/criterion2.sh" || rc=1

echo
echo "### artefact digests of the three retro-verified ADRs"
REPO="$REPO" bash "$HERE/digests.sh" || true

echo
echo "### SEC-001 downstream-gating closure (acceptance criterion 5)"
node "$HERE/reach.mjs" || rc=1

echo
echo "### artefact integrity"
( cd "$HERE" && sha256sum -c SHA256SUMS ) || rc=1

echo
echo "reproduce.sh rc=$rc"
exit $rc
