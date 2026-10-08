#!/usr/bin/env bash
# t_dbecf24d — rollout: back up the stale installed copies, install the master gate in the 7 gated
# profiles, then run the verifier (--live with the selftest fixture board). Transcripts → this dir.
#
# Usage: bash rollout.sh <selftest-fixture-dir>   (from: node scripts/qa/signoff-gate.selftest.mjs --keep)
set -uo pipefail
FX="${1:?selftest fixture dir}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
PROFILES=(architect backend browser docs frontend product qa)
BK="${TMPDIR:-/home/sap/.hermes/profiles/qa/cache/scratch}/t_dbecf24d-agent-hooks-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${BK}"

prof_args=()
for p in "${PROFILES[@]}"; do prof_args+=(--profile "${p}"); done

{
  echo "# pre-install installed copies (sha256) — backups in profile-local scratch, not committed"
  for p in "${PROFILES[@]}"; do
    mkdir -p "${BK}/${p}"
    cp -p "/home/sap/.hermes/profiles/${p}/agent-hooks/signoff-gate.mjs" "/home/sap/.hermes/profiles/${p}/agent-hooks/qa-signoff-gate.sh" "${BK}/${p}/"
    sha256sum "/home/sap/.hermes/profiles/${p}/agent-hooks/signoff-gate.mjs" "/home/sap/.hermes/profiles/${p}/agent-hooks/qa-signoff-gate.sh"
  done
  echo
  echo "# repo (origin/master $(git -C "${REPO}" rev-parse --short origin/master), clone HEAD $(git -C "${REPO}" rev-parse --short HEAD))"
  sha256sum "${REPO}/scripts/qa/signoff-gate.mjs" "${REPO}/scripts/qa/hooks/qa-signoff-gate.sh"
} > "${HERE}/pre-install-hashes.txt" 2>&1
cat "${HERE}/pre-install-hashes.txt"

echo "+ install-signoff-gate.sh --all (dry run, shows what --all selects)"
bash "${REPO}/scripts/qa/hooks/install-signoff-gate.sh" --all > "${HERE}/install-all-dryrun.txt" 2>&1
echo "  exit=$?" >> "${HERE}/install-all-dryrun.txt"
tail -3 "${HERE}/install-all-dryrun.txt"

echo "+ install-signoff-gate.sh ${prof_args[*]} --apply"
bash "${REPO}/scripts/qa/hooks/install-signoff-gate.sh" "${prof_args[@]}" --apply > "${HERE}/install-apply.txt" 2>&1
echo "exit=$?" >> "${HERE}/install-apply.txt"
cat "${HERE}/install-apply.txt"

echo "+ verify-signoff-gate.sh ${prof_args[*]} --live"
bash "${REPO}/scripts/qa/hooks/verify-signoff-gate.sh" "${prof_args[@]}" --live \
  --fixture-db "${FX}/board.db" --fixture-noncompliant t_b000000b --fixture-compliant t_b0000000 \
  --fixture-repo "${FX}/repo" > "${HERE}/verify-live.txt" 2>&1
echo "exit=$?" >> "${HERE}/verify-live.txt"
sed -i "s#${FX}#<selftest-fixture>#g" "${HERE}/verify-live.txt"
cat "${HERE}/verify-live.txt"
echo "backup dir: ${BK}"
