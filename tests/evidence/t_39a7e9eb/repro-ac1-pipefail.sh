#!/usr/bin/env bash
# t_39a7e9eb — AC1: the hooks-list presence test no longer depends on how the pipe ends.
# Replays, on one real profile, (1) the OLD test from master (`hermes … | grep -q` under
# pipefail) and (2) the NEW test exactly as verify-signoff-gate.sh now writes it (capture,
# then filter). Read-only: `hermes hooks list` only reads config.yaml + the allowlist.
# Usage: bash repro-ac1-pipefail.sh [profile]   (default qa) — output: repro-ac1-pipefail.txt
set -uo pipefail
P="${1:-qa}"
pd="${HOME}/.hermes/profiles/${P}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${HERE}/repro-ac1-pipefail.txt"
{
  echo "# repro-ac1-pipefail.sh — $(date -u +%FT%TZ) — profile ${P} — shell options: $(set -o | awk '$1=="pipefail"{print "pipefail="$2}')"
  for i in 1 2 3 4 5; do
    # OLD (master before t_39a7e9eb): presence decided by the pipeline's status.
    if HERMES_HOME="${pd}" hermes hooks list 2>/dev/null | grep -q "qa-signoff-gate.sh"; then old="present"; else old="ABSENT"; fi
    # NEW (this branch): capture in full, then filter.
    hooks_list_out="$(HERMES_HOME="${pd}" hermes hooks list 2>/dev/null)"; hooks_list_rc=$?
    hook_line="$(grep -m 1 -F "qa-signoff-gate.sh" <<<"${hooks_list_out}")"
    if [ "${hooks_list_rc}" -ne 0 ]; then new="hermes-failed(${hooks_list_rc})"; elif [ -n "${hook_line}" ]; then new="present"; else new="ABSENT"; fi
    echo "run ${i}: old test -> ${old} · new test -> ${new} (hermes exit ${hooks_list_rc})"
  done
  HERMES_HOME="${pd}" hermes hooks list 2>/dev/null | grep -q "qa-signoff-gate.sh"
  echo "old pipeline PIPESTATUS=${PIPESTATUS[*]}  (hermes · grep)"
} > "${OUT}" 2>&1
sed -i "s#${HOME}#~#g" "${OUT}"
cat "${OUT}"
