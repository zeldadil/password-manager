#!/usr/bin/env bash
# QA-001h QA sign-off gate — Hermes `pre_tool_call` shell hook.
#
# Blocks `kanban_complete` when the card has no QA verdict + evidence, per
# QA_SIGN_OFF_GATE.md and TEST_STRATEGY §11/§12.
#
# This file is what a profile's config.yaml points at:
#
#   hooks:
#     pre_tool_call:
#       - matcher: "^kanban_complete$"
#         command: "<profile>/agent-hooks/qa-signoff-gate.sh"
#         timeout: 30
#         fail_closed: true
#
# Install / refresh with scripts/qa/hooks/install-signoff-gate.sh, verify with
# scripts/qa/hooks/verify-signoff-gate.sh.
#
# Reads the Hermes hook payload on stdin, writes the decision JSON on stdout:
#   {"decision":"block","reason":...} + exit 2  → completion blocked
#   {}                                 + exit 0  → allowed
# Any internal failure fails closed (exit 2) because the config entry sets
# `fail_closed: true`; see QA_SIGN_OFF_GATE.md §6.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
GATE="${SIGNOFF_GATE_SCRIPT:-${HOOK_DIR}/signoff-gate.mjs}"

payload="$(cat)"

if ! command -v node >/dev/null 2>&1; then
  printf '{"decision":"block","reason":"signoff-gate: node is not on PATH — failing closed (QA_SIGN_OFF_GATE.md §6)."}\n'
  exit 2
fi

if [ ! -f "${GATE}" ]; then
  printf '{"decision":"block","reason":"signoff-gate: gate script not found at %s — failing closed. Reinstall: scripts/qa/hooks/install-signoff-gate.sh"}\n' "${GATE}"
  exit 2
fi

printf '%s' "${payload}" | node "${GATE}" hook
exit $?
