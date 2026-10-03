#!/usr/bin/env bash
# SEC-001 / T_B51A1FF3 — install the secret-guard hook into Hermes profile(s).
#
# Copies the hook + gate logic into <profile>/agent-hooks/ and patches the
# profile's config.yaml with the `pre_tool_call` entry that blocks
# kanban_comment / kanban_create / kanban_complete while the call text contains
# a secret-shaped value.
#
# Idempotent. Dry-run by default — nothing is written without --apply.
#
# Usage:
#   install-secret-guard.sh --all                 # dry run: all profiles
#   install-secret-guard.sh --profile architect --apply   # install for one profile
#   install-secret-guard.sh --all --apply         # board-wide rollout
#
# Options: --profile NAME (repeatable) · --all · --apply · --no-auto-accept
#          --profiles-root DIR (default: $HERMES_PROFILES_ROOT or ~/.hermes/profiles)
#          --hook-dir-only (copy the scripts, do not touch config.yaml)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
HOOK_SRC="${SCRIPT_DIR}/secret-guard.sh"
GATE_SRC="${REPO_ROOT}/scripts/qa/secret-guard.mjs"
PATCHER="${SCRIPT_DIR}/patch-config.py"

PROFILE_ROOT="${HERMES_PROFILES_ROOT:-${HOME}/.hermes/profiles}"
APPLY=0
AUTO_ACCEPT=1
HOOK_DIR_ONLY=0
PROFILES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILES+=("$2"); shift 2 ;;
    --all) while IFS= read -r d; do PROFILES+=("$(basename "${d}")"); done < <(find "${PROFILE_ROOT}" -mindepth 1 -maxdepth 1 -type d -not -name '.*' | sort); shift ;;
    --apply) APPLY=1; shift ;;
    --no-auto-accept) AUTO_ACCEPT=0; shift ;;
    --hook-dir-only) HOOK_DIR_ONLY=1; shift ;;
    --profiles-root) PROFILE_ROOT="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "install-secret-guard: unknown argument $1" >&2; exit 3 ;;
  esac
done

if [ "${#PROFILES[@]}" -eq 0 ]; then
  echo "install-secret-guard: no profiles selected (use --profile NAME or --all)" >&2
  exit 3
fi
[ -f "${HOOK_SRC}" ] || { echo "install-secret-guard: missing ${HOOK_SRC}" >&2; exit 3; }
[ -f "${GATE_SRC}" ] || { echo "install-secret-guard: missing ${GATE_SRC}" >&2; exit 3; }

mode="DRY RUN"
[ "${APPLY}" -eq 1 ] && mode="APPLY"
fail=0
echo "secret-guard installer — ${mode} · profiles root: ${PROFILE_ROOT}"
echo "hook source:  ${HOOK_SRC}"
echo "gate source:  ${GATE_SRC}"
echo

for profile in "${PROFILES[@]}"; do
  pd="${PROFILE_ROOT}/${profile}"
  cfg="${pd}/config.yaml"
  echo "── ${profile} (${pd})"
  if [ ! -d "${pd}" ]; then
    echo "   SKIP — profile directory not found"
    fail=1
    continue
  fi
  hooks_dir="${pd}/agent-hooks"
  hook_dst="${hooks_dir}/secret-guard.sh"
  gate_dst="${hooks_dir}/secret-guard.mjs"

  if [ "${APPLY}" -eq 1 ]; then
    mkdir -p "${hooks_dir}"
    install -m 0755 "${HOOK_SRC}" "${hook_dst}"
    install -m 0644 "${GATE_SRC}" "${gate_dst}"
    echo "   copied secret-guard.sh + secret-guard.mjs → ${hooks_dir}/"
  else
    echo "   would copy secret-guard.sh + secret-guard.mjs → ${hooks_dir}/"
  fi

  if [ "${HOOK_DIR_ONLY}" -eq 1 ]; then
    echo "   --hook-dir-only: config.yaml untouched"
    continue
  fi

  if [ ! -f "${cfg}" ]; then
    echo "   SKIP config — ${cfg} not found"
    fail=1
    continue
  fi

  if grep -q "secret-guard.sh" "${cfg}"; then
    echo "   config already carries the hook entry (idempotent no-op)"
  elif [ "${APPLY}" -eq 1 ]; then
    if [ "${AUTO_ACCEPT}" -eq 1 ]; then
      python3 "${PATCHER}" "${cfg}" "${hook_dst}" --hook-marker "secret-guard.sh" --matcher '^(kanban_comment|kanban_create|kanban_complete)$' --auto-accept || fail=1
      echo "   patched ${cfg} (fail_closed: true, hooks_auto_accept: true for non-TTY workers)"
    else
      python3 "${PATCHER}" "${cfg}" "${hook_dst}" --hook-marker "secret-guard.sh" --matcher '^(kanban_comment|kanban_create|kanban_complete)$' || fail=1
      echo "   patched ${cfg} (fail_closed: true)"
    fi
  else
    auto_flag=""
    [ "${AUTO_ACCEPT}" -eq 1 ] && auto_flag="--auto-accept"
    echo "   would patch ${cfg} with pre_tool_call matcher ^(kanban_comment|kanban_create|kanban_complete)$ → ${hook_dst}"
    if ! python3 "${PATCHER}" "${cfg}" "${hook_dst}" --hook-marker "secret-guard.sh" --matcher '^(kanban_comment|kanban_create|kanban_complete)$' ${auto_flag} --dry-run >/dev/null 2>&1; then
      echo "   WARN — dry-run validation failed for ${cfg}"
      fail=1
    fi
  fi

  if command -v hermes >/dev/null 2>&1; then
    if HERMES_HOME="${pd}" hermes config get hooks 2>/dev/null | grep -q "secret-guard.sh"; then
      echo "   verified: hermes config get hooks lists the hook"
    elif [ "${APPLY}" -eq 1 ]; then
      echo "   WARN — hermes config get hooks does not list the hook yet"
      fail=1
    fi
  fi
  echo
done

echo "Rollback: restore <profile>/config.yaml.bak.<timestamp> and delete <profile>/agent-hooks/."
echo "Kill switch: touch ~/.hermes/secret-guard.disabled (allows every guarded call while present)."
[ "${APPLY}" -eq 1 ] && echo "Next: scripts/qa/hooks/verify-secret-guard.sh --all --live"
exit "${fail}"
