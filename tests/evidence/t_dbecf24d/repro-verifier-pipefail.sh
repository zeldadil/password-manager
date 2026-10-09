#!/usr/bin/env bash
# Repro: verify-signoff-gate.sh "hooks list" check under `set -o pipefail`.
set -uo pipefail
pd=/home/sap/.hermes/profiles/qa
HERMES_HOME="${pd}" hermes hooks list > "${TMPDIR}/hl.out" 2> "${TMPDIR}/hl.err"
echo "hooks list exit=$? stdout_lines=$(wc -l < "${TMPDIR}/hl.out") stderr_lines=$(wc -l < "${TMPDIR}/hl.err")"
grep -c "qa-signoff-gate.sh" "${TMPDIR}/hl.out"
HERMES_HOME="${pd}" hermes hooks list 2>/dev/null | grep -q "qa-signoff-gate.sh"
echo "pipeline (pipefail, grep -q) PIPESTATUS=${PIPESTATUS[*]}"
set +o pipefail
HERMES_HOME="${pd}" hermes hooks list 2>/dev/null | grep -q "qa-signoff-gate.sh"
echo "pipeline (no pipefail) exit=$?"
