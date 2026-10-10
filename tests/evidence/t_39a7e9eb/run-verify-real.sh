#!/usr/bin/env bash
# t_39a7e9eb — AC3: replay the fixed verifier (--live) on the 7 real profiles + 1 negative control.
#
# Run 1  verifier + gate of THIS tree (origin/master gate + fixed verifier), 7 real profiles.
# Run 2  same fixed verifier, but in a detached worktree at PIN (default fdaabca = the revision
#        whose signoff-gate.mjs is byte-identical to what is installed in the 7 profiles today),
#        so the sha256 check compares against the revision actually rolled out.
# Run 3  negative control, REAL hermes: a throwaway profile root holding one profile whose
#        config has no sign-off hook at all (only an unrelated trivial hook). Must FAIL.
#
# Read-only on the real profiles: the verifier only reads files and runs `hermes config get /
# hooks list / hooks doctor / hooks test` against a selftest fixture board (never the live board).
# Usage: bash run-verify-real.sh [PIN]   — output: verify-real-7-profiles.txt
set -uo pipefail
PIN="${1:-fdaabca}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
OUT="${HERE}/verify-real-7-profiles.txt"
S="$(mktemp -d "${TMPDIR:-/tmp}/t39-real-XXXXXX")"
args=()
for p in architect backend browser docs frontend product qa; do args+=(--profile "${p}"); done

# selftest fixture (board.db + repo) built by the selftest of a given tree
mkfix() {
  local tree="$1" log before after
  log="${S}/selftest-$(basename "${tree}").log"
  before="$(ls -d "${S}"/signoff-gate-selftest-* 2>/dev/null | sort)"
  TMPDIR="${S}" node "${tree}/scripts/qa/signoff-gate.selftest.mjs" --keep > "${log}" 2>&1
  echo "# fixture selftest ($(basename "${tree}")): $(tail -1 "${log}")" >&2
  after="$(ls -d "${S}"/signoff-gate-selftest-* | sort)"
  comm -13 <(printf '%s\n' "${before}") <(printf '%s\n' "${after}") | head -1
}
run() {
  local tree="$1" fx
  shift
  fx="$(mkfix "${tree}")"
  TMPDIR="${S}" bash "${tree}/scripts/qa/hooks/verify-signoff-gate.sh" "$@" --live \
    --fixture-db "${fx}/board.db" --fixture-noncompliant t_b000000b --fixture-compliant t_b0000000 \
    --fixture-repo "${fx}/repo"
  echo "exit=$?"
}

git -C "${REPO}" worktree add -q --detach "${S}/pin" "${PIN}"
cp "${REPO}/scripts/qa/hooks/verify-signoff-gate.sh" "${S}/pin/scripts/qa/hooks/verify-signoff-gate.sh"

mkdir -p "${S}/neg/nohook/agent-hooks"
printf '#!/bin/sh\necho "{}"\n' > "${S}/neg/nohook/agent-hooks/other-hook.sh"
chmod +x "${S}/neg/nohook/agent-hooks/other-hook.sh"
cat > "${S}/neg/nohook/config.yaml" <<EOF
hooks:
  pre_tool_call:
    - matcher: ^kanban_comment\$
      command: ${S}/neg/nohook/agent-hooks/other-hook.sh
      timeout: 30
      fail_closed: true
hooks_auto_accept: true
EOF

{
  echo "# run-verify-real.sh — $(date -u +%FT%TZ) — branch HEAD $(git -C "${REPO}" rev-parse --short HEAD) (+ working tree) — verifier sha256 $(sha256sum "${REPO}/scripts/qa/hooks/verify-signoff-gate.sh" | cut -c1-12)"
  echo "# installed signoff-gate.mjs per profile:"
  for p in architect backend browser docs frontend product qa; do
    echo "#   ${p}: $(sha256sum "${HOME}/.hermes/profiles/${p}/agent-hooks/signoff-gate.mjs" | cut -c1-12)"
  done
  echo "# gate sha256 at HEAD: $(sha256sum "${REPO}/scripts/qa/signoff-gate.mjs" | cut -c1-12) · at PIN ${PIN}: $(sha256sum "${S}/pin/scripts/qa/signoff-gate.mjs" | cut -c1-12)"
  echo
  echo "################ RUN 1 — 7 real profiles, gate of this tree (master) ################"
  run "${REPO}" "${args[@]}"
  echo
  echo "################ RUN 2 — 7 real profiles, gate pinned at ${PIN} (installed revision) ################"
  run "${S}/pin" "${args[@]}"
  echo
  echo "################ RUN 3 — NEGATIVE CONTROL: profile with no sign-off hook (real hermes) ################"
  run "${S}/pin" --profiles-root "${S}/neg" --profile nohook
} > "${OUT}" 2>&1
git -C "${REPO}" worktree remove --force "${S}/pin"
sed -i "s#${S}#<scratch>#g; s#${HOME}#~#g" "${OUT}"
rm -rf "${S}"
grep -E '^(####|# fixture|verification:|exit=)' "${OUT}"
