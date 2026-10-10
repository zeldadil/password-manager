#!/usr/bin/env bash
# t_5b5b61e2 — RED/GREEN + no-regression evidence.
#  1. selftest of the branch, branch gate                             → expect all green
#  2. selftest of the branch against the BASE gate + BASE summary     → expect only the new section-10 cases red
#  3. A/B master gate vs branch gate on one read-only snapshot of the live board (GitHub live and off):
#     0 violation-set changes, the only advisory change is the new X3_COMPLETED_OUTSIDE_HOOK
#  4. the branch audit's bypass block on that snapshot (text) + the measured counts
# Usage: NODE_BIN=<dir with node 22> BASE=<commit> bash tests/evidence/t_5b5b61e2/red-green-ab.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
BASE="${BASE:?set BASE to the origin/master commit the branch is based on}"
SCRATCH="${TMPDIR:-/home/sap/.hermes/profiles/qa/cache/scratch}/t_5b5b61e2-ab"
mkdir -p "${SCRATCH}"
if [ -n "${NODE_BIN:-}" ]; then export PATH="${NODE_BIN}:${PATH}"; fi
cd "${REPO}"

node scripts/qa/signoff-gate.selftest.mjs > "${HERE}/selftest-green.txt" 2>&1
echo "exit=$?  node=$(node --version)  gate sha256=$(sha256sum scripts/qa/signoff-gate.mjs | cut -d' ' -f1)" >> "${HERE}/selftest-green.txt"

# BASE gate + BASE summary script + the branch selftest, in a throwaway copy.
RED="${SCRATCH}/red/scripts/qa"
mkdir -p "${RED}"
git show "${BASE}:scripts/qa/signoff-gate.mjs" > "${RED}/signoff-gate.mjs"
git show "${BASE}:scripts/qa/signoff-audit-summary.mjs" > "${RED}/signoff-audit-summary.mjs"
git show "${BASE}:scripts/qa/secret-guard.mjs" > "${RED}/secret-guard.mjs"
cp scripts/qa/signoff-gate.selftest.mjs "${RED}/"
cp -r scripts/qa/fixtures "${RED}/" 2>/dev/null
node "${RED}/signoff-gate.selftest.mjs" > "${HERE}/selftest-red.txt" 2>&1
echo "exit=$?  node=$(node --version)  gate=${BASE}:scripts/qa/signoff-gate.mjs sha256=$(sha256sum "${RED}/signoff-gate.mjs" | cut -d' ' -f1)  summary sha256=$(sha256sum "${RED}/signoff-audit-summary.mjs" | cut -d' ' -f1)" >> "${HERE}/selftest-red.txt"

# A/B on a read-only snapshot of the live board (.backup; the live board is never written).
LIVE="${SCRATCH}/board-snapshot.db"
sqlite3 /home/sap/.hermes/kanban.db ".backup '${LIVE}'"
{
  echo "base=${BASE} master-gate sha256=$(sha256sum "${RED}/signoff-gate.mjs" | cut -d' ' -f1)"
  echo "branch-gate sha256=$(sha256sum scripts/qa/signoff-gate.mjs | cut -d' ' -f1)"
  echo "snapshot taken $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "${HERE}/ab-live-board.txt"
for mode in live off; do
  envset=(); [ "${mode}" = off ] && envset=(QA_GATE_GITHUB=off)
  env "${envset[@]}" node "${RED}/signoff-gate.mjs" audit --repo "${REPO}" --db "${LIVE}" --json > "${SCRATCH}/master-${mode}.json" 2>/dev/null; me=$?
  env "${envset[@]}" node scripts/qa/signoff-gate.mjs audit --repo "${REPO}" --db "${LIVE}" --json > "${SCRATCH}/branch-${mode}.json" 2>/dev/null; be=$?
  node "${HERE}/ab-compare.mjs" "${SCRATCH}/master-${mode}.json" "${SCRATCH}/branch-${mode}.json" "github=${mode} exit master=${me} branch=${be}" >> "${HERE}/ab-live-board.txt"
done

# The branch audit's bypass block on the same snapshot, GitHub off — committed WITHOUT the
# free-text reasons (public repo): card, date, author, state, reason length only.
node "${HERE}/live-block.mjs" "${SCRATCH}/branch-off.json" > "${HERE}/live-board-bypass-block.txt"
sed -i "s#${SCRATCH}#<scratch>#g; s#${REPO}#<repo>#g" "${HERE}/ab-live-board.txt"

cat "${HERE}/ab-live-board.txt"
tail -3 "${HERE}/selftest-green.txt"
grep -cE '^  FAIL' "${HERE}/selftest-red.txt"
grep -E 'cases passed|^exit=' "${HERE}/selftest-red.txt"
