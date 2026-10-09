#!/usr/bin/env bash
# t_dbecf24d — re-run the verifier (post-install, --live) against the current installed copies.
# Usage: bash verify-rerun.sh <selftest-fixture-dir>
set -uo pipefail
FX="${1:?selftest fixture dir}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
OUT="${HERE}/verify-live-rerun.txt"
args=()
for p in architect backend browser docs frontend product qa; do args+=(--profile "${p}"); done
{
  echo "# verify-signoff-gate.sh --live re-run — $(date -u +%FT%TZ) — clone HEAD $(git -C "${REPO}" rev-parse --short HEAD)"
  bash "${REPO}/scripts/qa/hooks/verify-signoff-gate.sh" "${args[@]}" --live \
    --fixture-db "${FX}/board.db" --fixture-noncompliant t_b000000b --fixture-compliant t_b0000000 \
    --fixture-repo "${FX}/repo"
  echo "exit=$?"
} > "${OUT}" 2>&1
sed -i "s#${FX}#<selftest-fixture>#g" "${OUT}"
tail -3 "${OUT}"
