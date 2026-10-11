#!/usr/bin/env bash
# SEC-GATE / t_30e17642 — install the merge-guard hook into Hermes profile(s),
# every profile EXCEPT architect (the merge belongs to architect,
# QA_SIGN_OFF_GATE.md §5.9).
#
# Per profile: copies merge-guard.sh + merge-guard.mjs into <profile>/agent-hooks/,
# appends the `pre_tool_call` entry to config.yaml (patch-hook-entry.py: every other
# byte kept, YAML-proven before the write, backup config.yaml.bak.<timestamp>),
# records the hook consent in <profile>/shell-hooks-allowlist.json (approve-hook.py,
# same record as Hermes), then checks `hermes hooks list` for that profile.
#
# Idempotent. Dry-run by default — nothing is written without --apply.
#
# Usage:
#   install-merge-guard.sh --all                     # dry run: every profile but architect
#   install-merge-guard.sh --all --apply             # board-wide rollout
#   install-merge-guard.sh --profile qa --apply      # one profile
#
# Options: --profile NAME (repeatable; `architect` is refused) · --all · --apply
#          --profiles-root DIR (default: $HERMES_PROFILES_ROOT or ~/.hermes/profiles)
#          --no-approve (do not record consent; a profile without
#          hooks_auto_accept: true then silently skips the hook in headless runs)
#
# Rollback (per profile): restore <profile>/config.yaml.bak.<timestamp> (or delete the
# merge-guard entry), then `HERMES_HOME=<profile> hermes hooks revoke <hook path>`.
# There is no kill-switch file on purpose: any agent could create it.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
HOOK_SRC="${SCRIPT_DIR}/merge-guard.sh"
GATE_SRC="${REPO_ROOT}/scripts/qa/merge-guard.mjs"
PATCHER="${SCRIPT_DIR}/patch-hook-entry.py"
APPROVER="${SCRIPT_DIR}/approve-hook.py"
MATCHER='^(terminal|process_manage|execute_code|tool_call|mcp__.*merge.*)$'
EXCLUDED="architect"

PROFILE_ROOT="${HERMES_PROFILES_ROOT:-${HOME}/.hermes/profiles}"
APPLY=0
APPROVE=1
ALL=0
PROFILES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILES+=("$2"); shift 2 ;;
    --all) ALL=1; shift ;;
    --apply) APPLY=1; shift ;;
    --no-approve) APPROVE=0; shift ;;
    --profiles-root) PROFILE_ROOT="$2"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "install-merge-guard: unknown argument $1" >&2; exit 3 ;;
  esac
done

if [ "${ALL}" -eq 1 ]; then
  while IFS= read -r d; do
    name="$(basename "${d}")"
    [ "${name}" = "${EXCLUDED}" ] && continue
    PROFILES+=("${name}")
  done < <(find "${PROFILE_ROOT}" -mindepth 1 -maxdepth 1 -type d -not -name '.*' | sort)
fi

if [ "${#PROFILES[@]}" -eq 0 ]; then
  echo "install-merge-guard: no profiles selected (use --profile NAME or --all)" >&2
  exit 3
fi
for profile in "${PROFILES[@]}"; do
  if [ "${profile}" = "${EXCLUDED}" ]; then
    echo "install-merge-guard: refusing to install into '${EXCLUDED}' — the merge belongs to architect (QA_SIGN_OFF_GATE.md §5.9)" >&2
    exit 3
  fi
done
for f in "${HOOK_SRC}" "${GATE_SRC}" "${PATCHER}" "${APPROVER}"; do
  [ -f "${f}" ] || { echo "install-merge-guard: missing ${f}" >&2; exit 3; }
done

# patch-hook-entry.py proves the patched YAML with PyYAML. The host python3 may not
# carry it; Hermes's own venv does. $MERGE_GUARD_PYTHON wins when set.
PY=""
for cand in "${MERGE_GUARD_PYTHON:-}" python3 $(ls -t "${HOME}"/.hermes/installs/*/environments/*/venv/bin/python3 2>/dev/null); do
  [ -n "${cand}" ] || continue
  if "${cand}" -c 'import yaml' >/dev/null 2>&1; then PY="${cand}"; break; fi
done
if [ -z "${PY}" ]; then
  echo "install-merge-guard: no python3 with PyYAML found (set MERGE_GUARD_PYTHON)" >&2
  exit 3
fi

mode="DRY RUN"
[ "${APPLY}" -eq 1 ] && mode="APPLY"
fail=0
echo "merge-guard installer — ${mode} · profiles root: ${PROFILE_ROOT} · excluded: ${EXCLUDED}"
echo "hook source:  ${HOOK_SRC} (sha256 $(sha256sum "${HOOK_SRC}" | cut -c1-12)…)"
echo "gate source:  ${GATE_SRC} (sha256 $(sha256sum "${GATE_SRC}" | cut -c1-12)…)"
echo "matcher:      ${MATCHER}"
echo "python:       ${PY}"
echo

for profile in "${PROFILES[@]}"; do
  pd="${PROFILE_ROOT}/${profile}"
  cfg="${pd}/config.yaml"
  hooks_dir="${pd}/agent-hooks"
  hook_dst="${hooks_dir}/merge-guard.sh"
  gate_dst="${hooks_dir}/merge-guard.mjs"
  echo "── ${profile} (${pd})"
  if [ ! -d "${pd}" ]; then echo "   FAIL — profile directory not found"; fail=1; echo; continue; fi
  if [ ! -f "${cfg}" ]; then echo "   FAIL — ${cfg} not found"; fail=1; echo; continue; fi

  if [ "${APPLY}" -eq 1 ]; then
    mkdir -p "${hooks_dir}"
    install -m 0755 "${HOOK_SRC}" "${hook_dst}"
    install -m 0644 "${GATE_SRC}" "${gate_dst}"
    echo "   copied merge-guard.sh + merge-guard.mjs → ${hooks_dir}/"
    "${PY}" "${PATCHER}" "${cfg}" --command "${hook_dst}" --matcher "${MATCHER}" --marker "merge-guard.sh" --timeout 15 | sed 's/^/   /' || fail=1
    if [ "${APPROVE}" -eq 1 ]; then
      "${PY}" "${APPROVER}" "${pd}" "${hook_dst}" | sed 's/^/   /' || fail=1
    fi
  else
    echo "   would copy merge-guard.sh + merge-guard.mjs → ${hooks_dir}/"
    if grep -q "merge-guard.sh" "${cfg}"; then
      echo "   config already carries the merge-guard entry (idempotent no-op)"
    elif ! "${PY}" "${PATCHER}" "${cfg}" --command "${hook_dst}" --matcher "${MATCHER}" --marker "merge-guard.sh" --timeout 15 --dry-run | sed 's/^/   /'; then
      echo "   WARN — dry-run validation failed for ${cfg}"
      fail=1
    fi
    [ "${APPROVE}" -eq 1 ] && echo "   would record pre_tool_call consent for ${hook_dst} in ${pd}/shell-hooks-allowlist.json"
  fi

  if [ "${APPLY}" -eq 1 ] && command -v hermes >/dev/null 2>&1; then
    line="$(HERMES_HOME="${pd}" hermes hooks list 2>/dev/null | grep -F "merge-guard.sh" || true)"
    if [ -z "${line}" ]; then
      echo "   FAIL — hermes hooks list does not show merge-guard.sh"; fail=1
    elif printf '%s' "${line}" | grep -q "✓ allowed"; then
      echo "   verified: hermes hooks list → ${line# *}"
    else
      echo "   WARN — listed but not allowlisted: ${line# *}"; [ "${APPROVE}" -eq 1 ] && fail=1
    fi
  fi
  echo
done

[ "${APPLY}" -eq 1 ] && echo "Next: scripts/qa/hooks/verify-merge-guard.sh --all --live"
exit "${fail}"
