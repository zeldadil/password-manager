#!/usr/bin/env bash
# t_75180b28 — regenerate every committed transcript under tests/evidence/t_75180b28/
# with the CI's Node major. Run from the repo root.
set -uo pipefail
ev="tests/evidence/t_75180b28"
bash "$ev/reproduce.sh" "$ev"
bash "$ev/degradation.sh" "$ev"
bash "$ev/master-ci-history.sh" 40 > "$ev/master-ci-history.txt" 2>&1
echo "== done"
