#!/usr/bin/env bash
# QA-001h — verify the QA sign-off gate hook in Hermes profile(s).
#
# Structural + live checks per profile:
#   1. agent-hooks/qa-signoff-gate.sh + signoff-gate.mjs installed, exec bit set
#   2. installed gate logic matches the reviewed repo copy (sha256)
#   3. config.yaml carries the pre_tool_call entry with fail_closed: true
#   4. `hermes config get hooks` (profile-scoped) resolves the hook
#   5. `hermes hooks list` shows it with consent granted
#   6. `hermes hooks doctor` reports the sign-off hook's own section clean (another
#      hook's issues are printed as `info`, never counted — t_39a7e9eb)
#   7. live fire (`--live`): a synthetic pre_tool_call payload for a
#      non-compliant card must come back as `decision: block`, and a compliant
#      card must come back as `{}` — using --fixture-db / --fixture-noncompliant
#      / --fixture-compliant.
#
# Usage:
#   verify-signoff-gate.sh --all
#   verify-signoff-gate.sh --profile qa --live --fixture-db /tmp/fixture/board.db \
#                          --fixture-noncompliant t_b0000002 --fixture-compliant t_b0000000 \
#                          [--fixture-repo /tmp/fixture/repo]
#
# --fixture-repo sets the working directory of the live fire — i.e. the checkout the gate
# resolves repo-relative evidence paths against (the hook payload's `cwd` is the firing
# process's cwd). Pass the fixture repo that holds the compliant card's evidence, or a
# path-based compliant card will (correctly) block with R5.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
GATE_SRC="${REPO_ROOT}/scripts/qa/signoff-gate.mjs"
PROFILES_ROOT="${HERMES_PROFILES_ROOT:-${HOME}/.hermes/profiles}"
PROFILES=()
LIVE=0
FIXTURE_DB=""
FIXTURE_BAD=""
FIXTURE_GOOD=""
FIXTURE_REPO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILES+=("$2"); shift 2 ;;
    --all) while IFS= read -r d; do PROFILES+=("$(basename "${d}")"); done < <(find "${PROFILES_ROOT}" -mindepth 1 -maxdepth 1 -type d -not -name '.*' | sort); shift ;;
    --live) LIVE=1; shift ;;
    --fixture-db) FIXTURE_DB="$2"; shift 2 ;;
    --fixture-noncompliant) FIXTURE_BAD="$2"; shift 2 ;;
    --fixture-compliant) FIXTURE_GOOD="$2"; shift 2 ;;
    --fixture-repo) FIXTURE_REPO="$2"; shift 2 ;;
    --profiles-root) PROFILES_ROOT="$2"; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "verify-signoff-gate: unknown argument $1" >&2; exit 3 ;;
  esac
done

if [ "${#PROFILES[@]}" -eq 0 ]; then
  echo "verify-signoff-gate: no profiles selected (use --profile NAME or --all)" >&2
  exit 3
fi

pass=0
fail=0
warned=0
infos=0
ok()   { echo "   ok   - $1"; pass=$((pass + 1)); }
bad()  { echo "   FAIL - $1"; fail=$((fail + 1)); }
warn() { echo "   warn - $1"; warned=$((warned + 1)); }
# info: observed, deliberately NOT a verdict on the sign-off hook (e.g. another hook's drift).
info() { echo "   info - $1"; infos=$((infos + 1)); }

echo "QA sign-off gate verification — repo gate: ${GATE_SRC}"
echo

for profile in "${PROFILES[@]}"; do
  pd="${PROFILES_ROOT}/${profile}"
  cfg="${pd}/config.yaml"
  hook_dst="${pd}/agent-hooks/qa-signoff-gate.sh"
  gate_dst="${pd}/agent-hooks/signoff-gate.mjs"
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
    grep -q "qa-signoff-gate.sh" "${cfg}" && ok "config.yaml carries the hook command" || bad "config.yaml has no qa-signoff-gate.sh entry"
    grep -q "fail_closed: true" "${cfg}" && ok "config.yaml sets fail_closed: true" || bad "config.yaml does not set fail_closed: true"
    grep -q "^hooks_auto_accept: true" "${cfg}" && ok "config.yaml sets hooks_auto_accept: true (non-TTY workers)" || bad "hooks_auto_accept is not true — headless workers would silently skip the hook"
    # Hermes rewrites config.yaml when it records consent and normalises the quoted
    # matcher to a bare scalar, so accept both spellings (t_5455942d).
    if grep -Eq 'matcher:[[:space:]]*"?\^kanban_complete\$"?' "${cfg}"; then
      ok "matcher scoped to kanban_complete"
    else
      bad "matcher is not ^kanban_complete\$"
    fi
  else
    bad "config.yaml missing: ${cfg}"
  fi

  if command -v hermes >/dev/null 2>&1 && [ -f "${cfg}" ]; then
    # Capture each hermes command's output in full, THEN filter it (t_39a7e9eb).
    # `hermes … | grep -q` under `set -o pipefail` is a false negative: grep -q exits on
    # the first match, the next write from hermes hits a closed pipe, Python exits 120
    # on the failed stdout flush, and pipefail turns the pipeline red although the hook
    # IS listed. A capture also lets a genuine hermes failure be reported as such
    # instead of masquerading as "hook not shown".
    cfg_hooks_out="$(HERMES_HOME="${pd}" hermes config get hooks 2>/dev/null)"; cfg_hooks_rc=$?
    if [ "${cfg_hooks_rc}" -ne 0 ]; then
      bad "hermes config get hooks failed (exit ${cfg_hooks_rc})"
    elif grep -qF "qa-signoff-gate.sh" <<<"${cfg_hooks_out}"; then
      ok "hermes config get hooks resolves the hook for this profile"
    else
      bad "hermes config get hooks does not resolve the hook for this profile"
    fi
    hooks_list_out="$(HERMES_HOME="${pd}" hermes hooks list 2>/dev/null)"; hooks_list_rc=$?
    # The hook's own entry line (`- <path> matcher=… (timeout=…, ✓ allowed)`), never a
    # neighbouring hook's line.
    hook_line="$(grep -m 1 -F "qa-signoff-gate.sh" <<<"${hooks_list_out}")"
    if [ "${hooks_list_rc}" -ne 0 ]; then
      bad "hermes hooks list failed (exit ${hooks_list_rc})"
    elif [ -n "${hook_line}" ]; then
      ok "hermes hooks list shows the hook"
      if grep -q "^hooks_auto_accept: true" "${cfg}"; then
        ok "consent via hooks_auto_accept: true (headless workers do not need the interactive prompt)"
      elif grep -qF "✓ allowed" <<<"${hook_line}"; then
        ok "consent via shell-hooks allowlist"
      else
        bad "hook is neither allowlisted nor auto-accepted — non-TTY workers would silently skip it"
      fi
    else
      bad "hermes hooks list does not show the hook"
    fi
    doctor_out="${TMPDIR:-/tmp}/signoff-gate-doctor-${profile}.txt"
    if HERMES_HOME="${pd}" hermes hooks doctor >"${doctor_out}" 2>&1; then
      # `hermes hooks doctor` exits 0 even when it prints "issue(s) found", so the exit
      # code alone is not a clean bill of health — read the report (t_5455942d).
      # The report has one section per configured hook (`  [event] <command>`); only the
      # sign-off hook's own section decides ok/warn/FAIL here. Issues in another hook's
      # section (e.g. secret-guard.sh drift) are reported as info, never counted
      # (t_39a7e9eb) — that hook has its own verifier.
      doctor_tally="$(awk '
        /^  \[[^]]+\] / {
          cur = substr($0, index($0, "] ") + 2)
          sig = (cur ~ /(^|\/)qa-signoff-gate\.sh( |$)/)
          if (sig) seen = 1
          next
        }
        /^[^ ]/ { sig = 0; cur = ""; next }
        sig && /⚠/ { w++; if (/script modified since approval/) d++ }
        sig && /✗/ { x++ }
        !sig && cur != "" && (/⚠/ || /✗/) { other[cur]++ }
        END {
          printf "%d %d %d %d\n", seen + 0, w + 0, d + 0, x + 0
          for (k in other) printf "%s\t%d\n", k, other[k]
        }' "${doctor_out}")"
      read -r sig_seen sig_warns sig_drift sig_errors <<<"$(head -n 1 <<<"${doctor_tally}")"
      if [ "${sig_seen}" -ne 1 ]; then
        bad "hermes hooks doctor does not check the sign-off hook — see ${doctor_out}"
      elif [ "${sig_errors}" -gt 0 ] || [ "${sig_warns}" -gt "${sig_drift}" ] || [ "${sig_drift}" -gt 1 ]; then
        bad "hermes hooks doctor: sign-off hook has issues beyond the expected mtime drift (${sig_errors} error(s), ${sig_warns} warning(s)) — see ${doctor_out}"
      elif [ "${sig_drift}" -eq 1 ]; then
        warn "hermes hooks doctor: sign-off hook shows only the expected post-install mtime drift (approval refresh is interactive-only; hooks_auto_accept: true keeps the hook live — see the live fire below)"
      else
        ok "hermes hooks doctor: sign-off hook clean (transcript: ${doctor_out})"
      fi
      while IFS=$'\t' read -r other_hook other_n; do
        [ -n "${other_hook}" ] || continue
        info "hermes hooks doctor: ${other_n} issue(s) on an unrelated hook ${other_hook} — not counted here (see ${doctor_out})"
      done < <(tail -n +2 <<<"${doctor_tally}")
    else
      bad "hermes hooks doctor reported a problem — see ${doctor_out}"
    fi
  fi

  if [ "${LIVE}" -eq 1 ]; then
    if [ -z "${FIXTURE_DB}" ] || [ -z "${FIXTURE_BAD}" ] || [ -z "${FIXTURE_GOOD}" ]; then
      bad "--live needs --fixture-db, --fixture-noncompliant and --fixture-compliant"
    else
      bad_payload="$(mktemp)"
      good_payload="$(mktemp)"
      # Hermes wire shape: `tool_input` comes from the `args` kwarg, the worker's
      # task id arrives as a top-level `task_id` kwarg (landing in `extra`).
      # `payload.cwd` is always Path.cwd() of the firing process, so the fire runs
      # from --fixture-repo: that is the checkout the gate resolves repo-relative
      # evidence against (a payload-file "cwd" key would land in `extra` instead).
      printf '{"args":{"task_id":"%s","summary":"verification fire"},"task_id":"%s"}\n' "${FIXTURE_BAD}" "${FIXTURE_BAD}" > "${bad_payload}"
      printf '{"args":{"task_id":"%s","summary":"verification fire"},"task_id":"%s"}\n' "${FIXTURE_GOOD}" "${FIXTURE_GOOD}" > "${good_payload}"

      fire() {
        if [ -n "${FIXTURE_REPO}" ]; then
          ( cd "${FIXTURE_REPO}" && HERMES_HOME="${pd}" HERMES_KANBAN_DB="${FIXTURE_DB}" hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file "$1" 2>&1 )
        else
          HERMES_HOME="${pd}" HERMES_KANBAN_DB="${FIXTURE_DB}" hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file "$1" 2>&1
        fi
      }

      # Here-strings, not `printf | grep -q` pipelines: same pipefail class as above.
      bad_out="$(fire "${bad_payload}")"
      if grep -qF '"action": "block"' <<<"${bad_out}"; then
        ok "live fire — non-compliant card ${FIXTURE_BAD} blocked (exit 2 + action:block)"
      else
        bad "live fire did not block ${FIXTURE_BAD}: $(printf '%s' "${bad_out}" | tail -3 | tr '\n' ' ')"
      fi
      good_out="$(fire "${good_payload}")"
      if grep -qF "exit=0" <<<"${good_out}" && grep -qF "parsed: <none" <<<"${good_out}"; then
        ok "live fire — compliant card ${FIXTURE_GOOD} allowed (exit 0, no dispatcher contribution)"
      else
        bad "live fire did not allow ${FIXTURE_GOOD}: $(printf '%s' "${good_out}" | tail -3 | tr '\n' ' ')"
      fi
      rm -f "${bad_payload}" "${good_payload}"
    fi
  fi
  echo
done

echo "verification: ${pass} ok · ${warned} warn · ${fail} FAIL · ${infos} info (not counted)"
[ "${fail}" -eq 0 ] || exit 1
exit 0
