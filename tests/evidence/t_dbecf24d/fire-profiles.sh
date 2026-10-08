#!/usr/bin/env bash
# t_dbecf24d — per-profile live fire of the REAL installed hook on a fixture card with an OPEN PR.
#
# Usage: bash fire-profiles.sh <phase-label>      (e.g. pre-install / post-install)
#
# Fixture: a read-only snapshot of the live board (sqlite3 .backup) — the fire never touches the
# live board. Fixture card: t_20f78461 (BR-001a), linked to PR #110 which is OPEN on GitHub at
# fire time (re-read below, not assumed). `hermes hooks test` only fires the hook; it never
# calls kanban_complete.
#
# Per profile, three fires through `hermes hooks test pre_tool_call --for-tool kanban_complete`:
#   A. probe   — SIGNOFF_GATE_SCRIPT=hook-env-gh-probe.mjs: `gh auth status` + the installed gate's
#                `check --pre-complete --json` rule ids, from inside the hook subprocess;
#   B. real    — the profile's installed hook + gate, GitHub live: expect block with R9_PR_NOT_MERGED;
#   C. control — same as B with QA_GATE_GITHUB=off: expect NO R9 (fail-open → A11), proving B's R9
#                really comes from reading GitHub.
set -uo pipefail
PHASE="${1:?phase label}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
OUT="${HERE}/${PHASE}"
TASK="t_20f78461"
PROFILES=(architect backend browser docs frontend product qa)
SCRATCH="${TMPDIR:-/home/sap/.hermes/profiles/qa/cache/scratch}/t_dbecf24d-${PHASE}"
mkdir -p "${OUT}/probe" "${SCRATCH}"

FIXTURE_DB="${SCRATCH}/board-snapshot.db"
sqlite3 /home/sap/.hermes/kanban.db ".backup '${FIXTURE_DB}'"
PAYLOAD="${SCRATCH}/payload.json"
printf '{"args":{"task_id":"%s","summary":"t_dbecf24d rollout fire"},"task_id":"%s"}\n' "${TASK}" "${TASK}" > "${PAYLOAD}"

LOG="${OUT}/fires.txt"
: > "${LOG}"
log() { printf '%s\n' "$*" | tee -a "${LOG}"; }

log "# t_dbecf24d live fire — phase ${PHASE} — $(date -u +%FT%TZ)"
log "fixture board: sqlite3 .backup snapshot of ~/.hermes/kanban.db (live board not written)"
log "fixture card: ${TASK} — $(sqlite3 "${FIXTURE_DB}" "SELECT status||' · '||title FROM tasks WHERE id='${TASK}'")"
log "PR #110 now: $(gh pr view 110 -R zeldadil/password-manager --json number,state,headRefName --jq '"#\(.number) \(.state) head=\(.headRefName)"')"
log "repo gate (master clone): $(sha256sum "${REPO}/scripts/qa/signoff-gate.mjs" | cut -d' ' -f1)  @ $(git -C "${REPO}" rev-parse --short origin/master)"
log ""

fire() { # profile, extra env...
  local pd="/home/sap/.hermes/profiles/$1"; shift
  env -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE -u HERMES_KANBAN_BRANCH -u SIGNOFF_GATE_SCRIPT -u QA_GATE_GITHUB \
    HERMES_HOME="${pd}" HERMES_KANBAN_DB="${FIXTURE_DB}" "$@" \
    hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file "${PAYLOAD}" 2>&1
}

pass=0; fail=0
for p in "${PROFILES[@]}"; do
  log "── ${p}"
  log "   installed gate sha256: $(sha256sum /home/sap/.hermes/profiles/${p}/agent-hooks/signoff-gate.mjs | cut -d' ' -f1)"
  # A. probe
  fire "${p}" SIGNOFF_GATE_SCRIPT="${HERE}/hook-env-gh-probe.mjs" PROBE_OUT_DIR="${OUT}/probe" PROBE_TASK="${TASK}" > "${OUT}/probe/${p}.hooks-test.txt"
  pj="${OUT}/probe/${p}.json"
  if [ -f "${pj}" ]; then
    log "   A probe (inside hook): $(node "${HERE}/summarize-probe.mjs" "${pj}")"
  else
    log "   A probe: NO REPORT — see probe/${p}.hooks-test.txt"
  fi
  # B. real fire, GitHub live
  fire "${p}" > "${OUT}/${p}.real.txt"
  blocked=$(grep -c '"action": "block"' "${OUT}/${p}.real.txt" || true)
  r9=$(grep -c 'R9_PR_NOT_MERGED' "${OUT}/${p}.real.txt" || true)
  log "   B real fire (GitHub live): block=${blocked} R9_PR_NOT_MERGED=${r9}"
  # C. control, GitHub off
  fire "${p}" QA_GATE_GITHUB=off > "${OUT}/${p}.control-github-off.txt"
  r9c=$(grep -c 'R9_PR_NOT_MERGED' "${OUT}/${p}.control-github-off.txt" || true)
  log "   C control (QA_GATE_GITHUB=off): R9_PR_NOT_MERGED=${r9c}"
  if [ "${blocked}" -ge 1 ] && [ "${r9}" -ge 1 ] && [ "${r9c}" -eq 0 ] && grep -q '"auth_exit":0' <(node "${HERE}/summarize-probe.mjs" --json "${pj}" 2>/dev/null) && grep -q '"a11":false' <(node "${HERE}/summarize-probe.mjs" --json "${pj}" 2>/dev/null); then
    log "   RESULT ${p}: PASS (gh auth ok in hook env; R9 fires live; no A11; R9 disappears with GitHub off)"
    pass=$((pass + 1))
  else
    log "   RESULT ${p}: FAIL"
    fail=$((fail + 1))
  fi
  log ""
done
log "phase ${PHASE}: ${pass} PASS · ${fail} FAIL (of ${#PROFILES[@]} profiles)"
[ "${fail}" -eq 0 ]
