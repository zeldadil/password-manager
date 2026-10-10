#!/usr/bin/env bash
# t_90a4bd73 — RED run: the NEW selftest against the BASE gate (626feb7).
# Expected: every new R7 v2 case that targets a v1 defect fails, plus the
# slow-pipe case. The guards (c2) (f) (k) and (h) pass on v1 as well.
#   bash tests/evidence/t_90a4bd73/red-vs-base-gate.sh > out.txt
set -u
BASE=626feb7
D="$(mktemp -d)"
cp -r scripts/qa "$D/qa"
git show "$BASE:scripts/qa/signoff-gate.mjs" > "$D/qa/signoff-gate.mjs"
echo "node: $(node --version) · base gate $BASE sha256: $(sha256sum "$D/qa/signoff-gate.mjs" | cut -d' ' -f1)"
node "$D/qa/signoff-gate.selftest.mjs"
echo "selftest exit: $?"
