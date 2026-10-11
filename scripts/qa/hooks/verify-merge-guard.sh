#!/usr/bin/env bash
# SEC-GATE / t_30e17642 — verify the merge-guard hook in Hermes profile(s).
#
# Per profile:
#   1. agent-hooks/merge-guard.sh (executable) + merge-guard.mjs installed
#   2. installed hook + gate match the reviewed repo copies (sha256)
#   3. config.yaml carries the merge-guard pre_tool_call entry, fail_closed: true,
#      matcher covering terminal / process_manage / execute_code / tool_call / mcp merge
#   4. `hermes hooks list` shows it with consent granted (✓ allowed)
#   5. `hermes hooks doctor` reports no issue on the merge-guard entry
#   6. --live: `hermes hooks test` fires the real configured hook — `gh pr merge` and
#      `gh api -X PUT …/merge` are blocked, `gh pr view` and `git merge-base` allowed
# Plus the exclusion: `architect` must NOT carry the hook.
#
# Usage:
#   verify-merge-guard.sh --all [--live]          # every profile but architect + exclusion check
#   verify-merge-guard.sh --profile qa --live
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
HOOK_SRC="${SCRIPT_DIR}/merge-guard.sh"
GATE_SRC="${REPO_ROOT}/scripts/qa/merge-guard.mjs"
PROFILE_ROOT="${HERMES_PROFILES_ROOT:-${HOME}/.hermes/profiles}"
EXCLUDED="architect"
PROFILES=()
LIVE=0
ALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILES+=("$2"); shift 2 ;;
    --all) ALL=1; shift ;;
    --live) LIVE=1; shift ;;
    --profiles-root) PROFILE_ROOT="$2"; shift 2 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "verify-merge-guard: unknown argument $1" >&2; exit 3 ;;
  esac
done
if [ "${ALL}" -eq 1 ]; then
  while IFS= read -r d; do
    n="$(basename "${d}")"
    [ "${n}" = "${EXCLUDED}" ] || PROFILES+=("${n}")
  done < <(find "${PROFILE_ROOT}" -mindepth 1 -maxdepth 1 -type d -not -name '.*' | sort)
fi
if [ "${#PROFILES[@]}" -eq 0 ]; then
  echo "verify-merge-guard: no profiles selected (use --profile NAME or --all)" >&2
  exit 3
fi

pass=0
fail=0
ok()  { echo "   ok   - $1"; pass=$((pass + 1)); }
bad() { echo "   FAIL - $1"; fail=$((fail + 1)); }
sha() { sha256sum "$1" | cut -d' ' -f1; }

fire() { # profile-dir tool command → prints hermes hooks test output
  local pd="$1" tool="$2" cmd="$3" p
  p="$(mktemp "${TMPDIR:-/tmp}/merge-guard-verify-XXXXXX.json")"
  node -e 'const [t,c]=process.argv.slice(1);process.stdout.write(JSON.stringify({tool_name:t,tool_input:{command:c},args:{command:c}}))' "${tool}" "${cmd}" > "${p}"
  HERMES_HOME="${pd}" hermes hooks test pre_tool_call --for-tool "${tool}" --payload-file "${p}" 2>&1
  rm -f "${p}"
}

echo "merge-guard verification — repo hook sha256 $(sha "${HOOK_SRC}" | cut -c1-12)…, gate sha256 $(sha "${GATE_SRC}" | cut -c1-12)…"
echo

for profile in "${PROFILES[@]}"; do
  pd="${PROFILE_ROOT}/${profile}"
  cfg="${pd}/config.yaml"
  hook_dst="${pd}/agent-hooks/merge-guard.sh"
  gate_dst="${pd}/agent-hooks/merge-guard.mjs"
  echo "── ${profile} (${pd})"
  if [ "${profile}" = "${EXCLUDED}" ]; then bad "${EXCLUDED} is excluded by design — do not verify it as guarded"; echo; continue; fi

  [ -x "${hook_dst}" ] && ok "hook installed and executable" || bad "hook missing or not executable: ${hook_dst}"
  [ -f "${gate_dst}" ] && ok "gate logic installed" || bad "gate logic missing: ${gate_dst}"
  if [ -f "${hook_dst}" ] && [ "$(sha "${hook_dst}")" = "$(sha "${HOOK_SRC}")" ]; then ok "installed hook matches the repo copy"; else bad "installed hook differs from the repo copy — reinstall"; fi
  if [ -f "${gate_dst}" ] && [ "$(sha "${gate_dst}")" = "$(sha "${GATE_SRC}")" ]; then ok "installed gate matches the repo copy"; else bad "installed gate differs from the repo copy — reinstall"; fi

  if [ -f "${cfg}" ]; then
    entry="$(grep -n -B1 -A3 "merge-guard.sh" "${cfg}" || true)"
    if [ -n "${entry}" ]; then ok "config.yaml carries the merge-guard entry"; else bad "config.yaml has no merge-guard.sh entry"; fi
    printf '%s' "${entry}" | grep -q "fail_closed: true" && ok "entry sets fail_closed: true" || bad "entry does not set fail_closed: true"
    printf '%s' "${entry}" | grep -qF 'terminal|process_manage|execute_code|tool_call|mcp__.*merge.*' && ok "matcher covers terminal|process_manage|execute_code|tool_call|mcp merge" || bad "matcher does not cover the guarded tools"
  else
    bad "config.yaml missing: ${cfg}"
  fi

  if command -v hermes >/dev/null 2>&1; then
    line="$(HERMES_HOME="${pd}" hermes hooks list 2>/dev/null | grep -F "merge-guard.sh" || true)"
    if [ -z "${line}" ]; then bad "hermes hooks list does not show the hook"
    elif printf '%s' "${line}" | grep -q "✓ allowed"; then ok "hermes hooks list: listed, ✓ allowed"
    else bad "hermes hooks list: listed but not allowlisted"; fi
    doc="$(HERMES_HOME="${pd}" hermes hooks doctor 2>&1 | awk '/merge-guard.sh/{f=1} f&&/^$/{exit} f')"
    if [ -z "${doc}" ]; then bad "hermes hooks doctor did not check the hook"
    elif printf '%s' "${doc}" | grep -qE '⚠|✗|FAIL'; then bad "hermes hooks doctor flags the hook: $(printf '%s' "${doc}" | grep -E '⚠|✗' | head -2 | tr -s ' ')"
    else ok "hermes hooks doctor: merge-guard entry clean"; fi

    if [ "${LIVE}" -eq 1 ]; then
      out="$(fire "${pd}" terminal "gh pr merge 999999 -R zeldadil/password-manager --squash")"
      printf '%s' "${out}" | grep -q '"action": "block"' && printf '%s' "${out}" | grep -q "R_GH_PR_MERGE" && ok "live: gh pr merge blocked (R_GH_PR_MERGE)" || bad "live: gh pr merge NOT blocked: $(printf '%s' "${out}" | tail -2 | tr '\n' ' ')"
      out="$(fire "${pd}" terminal "gh api -X PUT repos/zeldadil/password-manager/pulls/999999/merge")"
      printf '%s' "${out}" | grep -q '"action": "block"' && ok "live: gh api -X PUT …/merge blocked" || bad "live: gh api PUT …/merge NOT blocked"
      out="$(fire "${pd}" terminal "gh pr view 999999 --json state,mergeable")"
      printf '%s' "${out}" | grep -q "exit=0" && printf '%s' "${out}" | grep -q "parsed: <none" && ok "live: gh pr view allowed" || bad "live: gh pr view NOT allowed: $(printf '%s' "${out}" | tail -2 | tr '\n' ' ')"
      out="$(fire "${pd}" terminal "git merge-base --is-ancestor HEAD origin/master")"
      printf '%s' "${out}" | grep -q "exit=0" && printf '%s' "${out}" | grep -q "parsed: <none" && ok "live: git merge-base allowed" || bad "live: git merge-base NOT allowed"
    fi
  fi
  echo
done

if [ "${ALL}" -eq 1 ]; then
  echo "── ${EXCLUDED} (exclusion check)"
  ad="${PROFILE_ROOT}/${EXCLUDED}"
  if [ -d "${ad}" ]; then
    grep -q "merge-guard.sh" "${ad}/config.yaml" 2>/dev/null && bad "${EXCLUDED}/config.yaml carries merge-guard — architect must keep the merge" || ok "${EXCLUDED}/config.yaml has no merge-guard entry"
    if command -v hermes >/dev/null 2>&1; then
      HERMES_HOME="${ad}" hermes hooks list 2>/dev/null | grep -q "merge-guard.sh" && bad "hermes hooks list shows merge-guard for ${EXCLUDED}" || ok "hermes hooks list for ${EXCLUDED} has no merge-guard"
    fi
  else
    echo "   (no ${EXCLUDED} profile under ${PROFILE_ROOT})"
  fi
  echo
fi

echo "verification: ${pass} ok · ${fail} FAIL"
[ "${fail}" -eq 0 ]
