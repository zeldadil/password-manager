#!/usr/bin/env bash
# t_39a7e9eb — AC1/AC2 unit cases: drive verify-signoff-gate.sh against a FAKE profile root
# and a stub `hermes` on PATH that replays canned `hooks list` / `hooks doctor` reports.
# Proves both directions: unrelated-hook issues are info (no FAIL), and every genuine
# defect of the sign-off hook still FAILs. No real profile, no real hermes is touched.
# Usage: bash stub-cases.sh   — output: stub-cases.txt ; exit 1 if any case misbehaves.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
# VERIFY / OUT overridable to replay the same cases on the pre-fix verifier (red control):
#   git show origin/master:scripts/qa/hooks/verify-signoff-gate.sh > old.sh
#   VERIFY=old.sh OUT=stub-cases.pre-fix.txt bash stub-cases.sh
VERIFY="${VERIFY:-${REPO}/scripts/qa/hooks/verify-signoff-gate.sh}"
OUT="${OUT:-${HERE}/stub-cases.txt}"
W="$(mktemp -d "${TMPDIR:-/tmp}/t39-stub-XXXXXX")"
mkdir -p "${W}/bin" "${W}/profiles/p/agent-hooks"
cp "${REPO}/scripts/qa/signoff-gate.mjs" "${W}/profiles/p/agent-hooks/signoff-gate.mjs"
printf '#!/bin/sh\necho "{}"\n' > "${W}/profiles/p/agent-hooks/qa-signoff-gate.sh"
chmod +x "${W}/profiles/p/agent-hooks/qa-signoff-gate.sh"
H="${W}/profiles/p/agent-hooks"
cat > "${W}/profiles/p/config.yaml" <<EOF
hooks:
  pre_tool_call:
    - matcher: ^kanban_complete\$
      command: ${H}/qa-signoff-gate.sh
      timeout: 30
      fail_closed: true
hooks_auto_accept: true
EOF
# Stub hermes: `config get hooks` prints config.yaml; `hooks list` / `hooks doctor` print
# ${STUB_DIR}/list.txt / doctor.txt and exit with ${STUB_LIST_RC:-0}. `hooks list` writes
# its output in many small chunks with a pause, like the real CLI, so a `| grep -q` reader
# would close the pipe early.
cat > "${W}/bin/hermes" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "config get") cat "${HERMES_HOME}/config.yaml" ;;
  "hooks list") while IFS= read -r l; do printf '%s\n' "$l"; sleep 0.01; done < "${STUB_DIR}/list.txt"; exit "${STUB_LIST_RC:-0}" ;;
  "hooks doctor") cat "${STUB_DIR}/doctor.txt" ;;
  *) echo "stub: unsupported $*" >&2; exit 9 ;;
esac
EOF
chmod +x "${W}/bin/hermes"

SIG="  [pre_tool_call] ${H}/qa-signoff-gate.sh"
OTH="  [pre_tool_call] ${H}/secret-guard.sh"
OK1="      ✓ script exists and is executable"
OK2="      ✓ allowlisted (approved 2026-09-17T21:51:39Z)"
OK3="      ✓ produced valid JSON on synthetic payload (exit=0, 0.05s)"
DRIFT="      ⚠ script modified since approval (was A, now B) — review changes"
LIST_OK="Configured shell hooks (2 total):

  [pre_tool_call]
    - ${H}/qa-signoff-gate.sh matcher='^kanban_complete\$' (timeout=30s, ✓ allowed)
      approved_at: 2026-09-17T21:51:39Z
    - ${H}/secret-guard.sh matcher='^(kanban_comment)\$' (timeout=30s, ✓ allowed)
      approved_at: 2026-09-17T21:51:39Z
      ⚠ script modified since approval (was A, now B)
    - ${H}/z1.sh
    - ${H}/z2.sh
    - ${H}/z3.sh"
LIST_NOHOOK="Configured shell hooks (1 total):

  [pre_tool_call]
    - ${H}/secret-guard.sh matcher='^(kanban_comment)\$' (timeout=30s, ✓ allowed)"

pass=0; bad=0
# case <name> <expected FAIL count> <expected info count> <expected FAIL pattern or -> <list> <doctor> [list_rc]
case_() {
  local name="$1" efail="$2" einfo="$3" epat="$4" list="$5" doctor="$6" rc="${7:-0}"
  local d="${W}/case"; rm -rf "${d}"; mkdir -p "${d}"
  printf '%s\n' "${list}" > "${d}/list.txt"; printf '%s\n' "${doctor}" > "${d}/doctor.txt"
  local o; o="$(PATH="${W}/bin:${PATH}" STUB_DIR="${d}" STUB_LIST_RC="${rc}" TMPDIR="${W}" bash "${VERIFY}" --profiles-root "${W}/profiles" --profile p 2>&1)"
  local nf ni; nf="$(grep -c '   FAIL - ' <<<"${o}")"; ni="$(grep -c '   info - ' <<<"${o}")"
  local verdict="ok"
  [ "${nf}" = "${efail}" ] || verdict="MISBEHAVES"
  [ "${ni}" = "${einfo}" ] || verdict="MISBEHAVES"
  if [ "${epat}" != "-" ] && ! grep -qF -- "${epat}" <<<"${o}"; then verdict="MISBEHAVES"; fi
  echo "[${verdict}] ${name}: FAIL=${nf} (want ${efail}) info=${ni} (want ${einfo})"
  grep -E '   (FAIL|warn|info) - ' <<<"${o}" | sed 's/^/      /'
  if [ "${verdict}" = "ok" ]; then pass=$((pass + 1)); else bad=$((bad + 1)); fi
}

{
  echo "# stub-cases.sh — $(date -u +%FT%TZ) — repo $(git -C "${REPO}" rev-parse --short HEAD) — verifier under test: ${VERIFY#${REPO}/} (sha256 $(sha256sum "${VERIFY}" | cut -c1-12))"
  case_ "A real shape (architect/docs/qa 2026-10-09): sign-off drift + unrelated secret-guard drift -> warn + info, 0 FAIL" 0 1 "unrelated hook ${H}/secret-guard.sh" \
    "${LIST_OK}" "Checking 2 configured shell hook(s)...

${SIG}
${OK1}
${OK2}
${DRIFT}
${OK3}

${OTH}
${OK1}
${OK2}
${DRIFT}
${OK3}

2 issue(s) found.  Fix before relying on these hooks."
  case_ "B all clean -> 0 FAIL, 0 info" 0 0 "sign-off hook clean" \
    "${LIST_OK}" "Checking 1 configured shell hook(s)...

${SIG}
${OK1}
${OK2}
${OK3}

All shell hooks look healthy."
  case_ "C negative: sign-off hook has a 2nd warning of its own -> FAIL" 1 0 "sign-off hook has issues beyond the expected mtime drift" \
    "${LIST_OK}" "${SIG}
${OK1}
${DRIFT}
      ⚠ not allowlisted — run hermes hooks approve
${OK3}"
  case_ "D negative: sign-off hook error (✗) even with the other hook clean -> FAIL" 1 0 "1 error(s)" \
    "${LIST_OK}" "${SIG}
${OK1}
      ✗ hook did not produce valid JSON (exit=1)

${OTH}
${OK1}"
  case_ "E negative: doctor has no section for the sign-off hook (only the other hook's) -> FAIL, other hook still info" 1 1 "does not check the sign-off hook" \
    "${LIST_OK}" "${OTH}
${OK1}
${DRIFT}"
  case_ "F negative: hooks list genuinely lacks the hook -> FAIL" 1 0 "hermes hooks list does not show the hook" \
    "${LIST_NOHOOK}" "${SIG}
${OK1}"
  case_ "G negative: hooks list itself fails (exit 120) -> FAIL reported as a hermes failure" 1 0 "hermes hooks list failed (exit 120)" \
    "${LIST_OK}" "${SIG}
${OK1}" 120
  case_ "H unrelated hook whose path merely contains the name (qa-signoff-gate.sh.bak) is not mistaken for the sign-off hook -> FAIL (no section)" 1 1 "does not check the sign-off hook" \
    "${LIST_OK}" "  [pre_tool_call] ${H}/qa-signoff-gate.sh.bak
${DRIFT}"
  echo
  echo "stub cases: ${pass} behave as expected · ${bad} misbehave"
} > "${OUT}" 2>&1
sed -i "s#${W}#<stub-root>#g" "${OUT}"
rm -rf "${W}"
cat "${OUT}"
[ "${bad}" -eq 0 ]
