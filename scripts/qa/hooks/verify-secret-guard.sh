#!/usr/bin/env bash
# SEC-001 / T_B51A1FF3 — verify the secret-guard hook in Hermes profile(s).
#
# Structural + live checks per profile:
#   1. agent-hooks/secret-guard.sh + secret-guard.mjs installed, exec bit set
#   2. installed gate logic matches the reviewed repo copy (sha256)
#   3. config.yaml carries the pre_tool_call entry with fail_closed: true
#   4. `hermes config get hooks` resolves the hook
#   5. `hermes hooks list` shows it with consent granted
# 6. `hermes hooks doctor` reports clean
#
# Usage:
#   verify-secret-guard.sh --all
#   verify-secret-guard.sh --profile architect --live \
#       --fixture-db /tmp/fixture/board.db \
#       --fixture-bad t_b0000001 --fixture-good t_b0000000
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
GATE_SRC="${REPO_ROOT}/scripts/qa/secret-guard.mjs"
PROFILE_ROOT="${HERMES_PROFILES_ROOT:-${HOME}/.hermes/profiles}"
PROFILES=()
LIVE=0
FIXTURE_DB=""
FIXTURE_BAD=""
FIXTURE_GOOD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILES+=("$2"); shift 2 ;;
    --all) while IFS= read -r d; do PROFILES+=("$(basename "${d}")"); done < <(find "${PROFILE_ROOT}" -mindepth 1 -maxdepth 1 -type d -not -name '.*' | sort); shift ;;
    --live) LIVE=1; shift ;;
    --fixture-db) FIXTURE_DB="$2"; shift 2 ;;
    --fixture-bad) FIXTURE_BAD="$2"; shift 2 ;;
    --fixture-good) FIXTURE_GOOD="$2"; shift 2 ;;
    --profiles-root) PROFILE_ROOT="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "verify-secret-guard: unknown argument $1" >&2; exit 3 ;;
  esac
done

if [ "${#PROFILES[@]}" -eq 0 ]; then
  echo "verify-secret-guard: no profiles selected (use --profile NAME or --all)" >&2
  exit 3
fi

pass=0
fail=0
ok()   { echo "   ok   - $1"; ((pass++)); }
bad()  { echo "   FAIL - $1"; ((fail++)); }

echo "secret-guard verification — repo gate: ${GATE_SRC}"
echo

for profile in "${PROFILES[@]}"; do
  pd="${PROFILE_ROOT}/${profile}"
  cfg="${pd}/config.yaml"
  hook_dst="${pd}/agent-hooks/secret-guard.sh"
  gate_dst="${pd}/agent-hooks/secret-guard.mjs"
  echo "── ${profile} (${pd})"

  if [ -x "${hook_dst}" ]; then ok "hook installed and executable: ${hook_dst}"; else bad "hook missing or not executable: ${hook_dst}"; fi
  if [ -f "${gate_dst}" ]; then ok "gate logic installed: ${gate_dst}"; else bad "gate logic missing: ${gate_dst}"; fi

  if [ -f "${gate_dst}" ] && [ -f "${GATE_SRC}" ]; then
    h_installed="$(sha256sum "${gate_dst}" | cut -d' ' -f1)"
    h_repo="$(sha256sum "${GATE_SRC}" | cut -d' ' -f1)"
    if [ "${h_installed}" = "${h_repo}" ]; then
      ok "installed gate matches the reviewed repo copy (sha256 ${h_repo:0:12}…)"
    else
      bad "installed gate differs from the repo copy (installed ${h_installed:0:12}… vs repo ${h_repo:0:12}…) — reinstall"
    fi
  fi

  if [ -f "${cfg}" ]; then
    grep -q "secret-guard.sh" "${cfg}" && ok "config.yaml carries the secret-guard hook command" || bad "config.yaml has no secret-guard.sh entry"
    grep -q "fail_closed: true" "${cfg}" && ok "config.yaml sets fail_closed: true" || bad "config.yaml does not set fail_closed: true"
    grep -qE 'matcher: "[^"]*kanban_comment[^"]*"' "${cfg}" && ok "matcher scoped to kanban_comment|kanban_create|kanban_complete (+review/block/changes)" || bad "matcher does not reference kanban_comment"
  else
    bad "config.yaml missing: ${cfg}"
  fi

  if command -v hermes >/dev/null 2>&1 && [ -f "${cfg}" ]; then
    if HERMES_HOME="${pd}" hermes config get hooks 2>/dev/null | grep -q "secret-guard.sh"; then
      ok "hermes config get hooks resolves the hook for this profile"
    else
      bad "hermes config get hooks does not resolve the hook for this profile"
    fi
    if HERMES_HOME="${pd}" hermes hooks list 2>/dev/null | grep -q "secret-guard.sh"; then
      ok "hermes hooks list shows the hook"
      if HERMES_HOME="${pd}" hermes hooks list 2>/dev/null | grep "secret-guard.sh" | grep -q "✓ allowed"; then
        ok "consent granted (headless workers do not need the interactive prompt)"
      elif grep -q "hooks_auto_accept: true" "${cfg}" 2>/dev/null; then
        ok "not yet allowlisted — will self-approve on first dispatch (hooks_auto_accept: true in config.yaml)"
      else
        bad "hook is not allowlisted — non-TTY workers would silently skip it"
      fi
    else
      bad "hermes hooks list does not show the hook"
    fi
    if HERMES_HOME="${pd}" hermes hooks doctor >"/tmp/secret-guard-doctor-${profile}.txt" 2>&1; then
      if grep -qiE "issue.*found" "/tmp/secret-guard-doctor-${profile}.txt"; then
        bad "hermes hooks doctor reports issues — see /tmp/secret-guard-doctor-${profile}.txt"
      else
        ok "hermes hooks doctor clean (transcript: /tmp/secret-guard-doctor-${profile}.txt)"
      fi
    else
      bad "hermes hooks doctor failed — see /tmp/secret-guard-doctor-${profile}.txt"
    fi
  fi

  if [ "${LIVE}" -eq 1 ]; then
    if [ -z "${FIXTURE_DB}" ] || [ -z "${FIXTURE_BAD}" ] || [ -z "${FIXTURE_GOOD}" ]; then
      bad "--live needs --fixture-db, --fixture-bad and --fixture-good"
    else
      bad_payload="$(mktemp)"
      good_payload="$(mktemp)"
      # Bad payload: kanban_comment with a Telegram bot token in the body.
      # Shape matches what secret-guard.mjs scanPayload() reads AND what hermes
      # hooks test sends on the wire (tool_name + args at top-level).
      SYNTH_TOKEN="12345678:$(printf 'A%.0s' {1..35})"
      printf '{"hook_event_name":"pre_tool_call","tool_name":"kanban_comment","args":{"task_id":"%s","body":"hello world %s bot"},"session_id":"sess_verify","cwd":"%s","profile":"backend"}\n' \
        "${FIXTURE_BAD}" "${SYNTH_TOKEN}" "${FIXTURE_DB}" > "${bad_payload}"
      # Good payload: kanban_comment with clean body (no secret shapes)
      printf '{"hook_event_name":"pre_tool_call","tool_name":"kanban_comment","args":{"task_id":"%s","body":"hello world, this is a clean comment"},"session_id":"sess_verify","cwd":"%s","profile":"backend"}\n' \
        "${FIXTURE_GOOD}" "${FIXTURE_DB}" > "${good_payload}"

      bad_out="$(HERMES_HOME="${pd}" HERMES_KANBAN_DB="${FIXTURE_DB}" hermes hooks test pre_tool_call --for-tool kanban_comment --payload-file "${bad_payload}" 2>&1)"
      if printf '%s' "${bad_out}" | grep -q '"action": "block"'; then
        ok "live fire — payload with Telegram bot token blocked (action:block)"
      else
        bad "live fire did not block the bad payload: $(printf '%s' "${bad_out}" | tail -3 | tr '\n' ' ')"
      fi

      good_out="$(HERMES_HOME="${pd}" HERMES_KANBAN_DB="${FIXTURE_DB}" hermes hooks test pre_tool_call --for-tool kanban_comment --payload-file "${good_payload}" 2>&1)"
      if printf '%s' "${good_out}" | grep -q "exit=0" && printf '%s' "${good_out}" | grep -q "parsed: <none"; then
        ok "live fire — clean payload allowed (exit 0, no dispatcher contribution)"
      else
        bad "live fire did not allow the good payload: $(printf '%s' "${good_out}" | tail -3 | tr '\n' ' ')"
      fi

      # Result-field case: token in kanban_complete.result (B2 — proves D2 deployed)
      result_payload="$(mktemp)"
      printf '{"hook_event_name":"pre_tool_call","tool_name":"kanban_complete","args":{"task_id":"%s","summary":"all tests pass","result":"done with bot token %s"},"session_id":"sess_verify","cwd":"%s","profile":"backend"}\n' \
        "${FIXTURE_BAD}" "${SYNTH_TOKEN}" "${FIXTURE_DB}" > "${result_payload}"
      result_out="$(HERMES_HOME="${pd}" HERMES_KANBAN_DB="${FIXTURE_DB}" hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file "${result_payload}" 2>&1)"
      if printf '%s' "${result_out}" | grep -q '"action": "block"'; then
        ok "live fire — token in kanban_complete.result blocked (action:block, D2 deployed)"
      else
        bad "live fire did not block token in kanban_complete.result: $(printf '%s' "${result_out}" | tail -3 | tr '\n' ' ')"
      fi
      rm -f "${result_payload}"

      rm -f "${bad_payload}" "${good_payload}"
    fi
  fi
  echo
done

echo "verification: ${pass} ok · ${fail} FAIL"
[ "${fail}" -eq 0 ] || exit 1
exit 0
