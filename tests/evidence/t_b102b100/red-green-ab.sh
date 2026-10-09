#!/usr/bin/env bash
# t_b102b100 — RED/GREEN + no-regression evidence.
#  1. selftest of the branch, branch gate                  → expect all green
#  2. selftest of the branch against the origin/master gate → expect only the new section-9 cases red
#  3. A/B per-card violation + advisory sets, master gate vs branch gate, on one read-only snapshot
#     of the live board (GitHub live and GitHub off): the change must not alter any card's rule set,
#     and exit codes must be identical without --fail-on-a11.
# Usage: NODE_BIN=<dir with node 22> BASE=<commit> bash tests/evidence/t_b102b100/red-green-ab.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
BASE="${BASE:?set BASE to the origin/master commit the branch is based on}"
SCRATCH="${TMPDIR:-/home/sap/.hermes/profiles/qa/cache/scratch}/t_b102b100-ab"
mkdir -p "${SCRATCH}"
if [ -n "${NODE_BIN:-}" ]; then export PATH="${NODE_BIN}:${PATH}"; fi
cd "${REPO}"

node scripts/qa/signoff-gate.selftest.mjs > "${HERE}/selftest-green.txt" 2>&1
echo "exit=$?  node=$(node --version)" >> "${HERE}/selftest-green.txt"

# Master gate + branch selftest + branch summary script in a throwaway copy.
RED="${SCRATCH}/red/scripts/qa"
mkdir -p "${RED}"
git show "${BASE}:scripts/qa/signoff-gate.mjs" > "${RED}/signoff-gate.mjs"
cp scripts/qa/signoff-gate.selftest.mjs scripts/qa/signoff-audit-summary.mjs "${RED}/"
cp -r scripts/qa/fixtures "${RED}/" 2>/dev/null
node "${RED}/signoff-gate.selftest.mjs" > "${HERE}/selftest-red.txt" 2>&1
echo "exit=$?  node=$(node --version)  gate=${BASE}:scripts/qa/signoff-gate.mjs sha256=$(sha256sum "${RED}/signoff-gate.mjs" | cut -d' ' -f1)" >> "${HERE}/selftest-red.txt"

# A/B on the live board snapshot.
LIVE="${SCRATCH}/board-snapshot.db"
sqlite3 /home/sap/.hermes/kanban.db ".backup '${LIVE}'"
{
  echo "base=${BASE} master-gate sha256=$(sha256sum "${RED}/signoff-gate.mjs" | cut -d' ' -f1)"
  echo "branch-gate sha256=$(sha256sum scripts/qa/signoff-gate.mjs | cut -d' ' -f1)"
} > "${HERE}/ab-live-board.txt"
for mode in live off; do
  envset=(); [ "${mode}" = off ] && envset=(QA_GATE_GITHUB=off)
  env "${envset[@]}" node "${RED}/signoff-gate.mjs" audit --repo "${REPO}" --db "${LIVE}" --json > "${SCRATCH}/master-${mode}.json" 2>/dev/null; me=$?
  env "${envset[@]}" node scripts/qa/signoff-gate.mjs audit --repo "${REPO}" --db "${LIVE}" --json > "${SCRATCH}/branch-${mode}.json" 2>/dev/null; be=$?
  env "${envset[@]}" node scripts/qa/signoff-gate.mjs audit --repo "${REPO}" --db "${LIVE}" --json --fail-on-a11 > /dev/null 2>&1; bf=$?
  node "${HERE}/ab-compare.mjs" "${SCRATCH}/master-${mode}.json" "${SCRATCH}/branch-${mode}.json" "github=${mode} exit master=${me} branch=${be} branch+--fail-on-a11=${bf}" >> "${HERE}/ab-live-board.txt"
done
cat "${HERE}/ab-live-board.txt"
tail -3 "${HERE}/selftest-green.txt"
grep -E '^  FAIL|cases passed|^exit=' "${HERE}/selftest-red.txt"
