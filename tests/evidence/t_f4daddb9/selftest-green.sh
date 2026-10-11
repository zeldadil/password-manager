#!/usr/bin/env bash
# t_f4daddb9 — GREEN: this branch's selftest against this branch's gate.
# Usage: bash tests/evidence/t_f4daddb9/selftest-green.sh > selftest-green.txt
set -u
NODE=${NODE:-node}
HERE=$(cd "$(dirname "$0")/../../.." && pwd)
echo "# GREEN: branch selftest vs branch gate @ $(git -C "$HERE" rev-parse --short HEAD) (+ working tree), node $($NODE --version)"
echo "# branch gate sha256: $(sha256sum "$HERE/scripts/qa/signoff-gate.mjs" | cut -d' ' -f1)"
echo "# selftest sha256:    $(sha256sum "$HERE/scripts/qa/signoff-gate.selftest.mjs" | cut -d' ' -f1)"
env -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE -u HERMES_KANBAN_BRANCH -u HERMES_KANBAN_DB $NODE "$HERE/scripts/qa/signoff-gate.selftest.mjs"
echo "# GREEN selftest exit=$?"
