#!/usr/bin/env bash
# SEC-001 / T_B51A1FF3 — Hermes `pre_tool_call` shell hook: secret-guard.
#
# Blocks kanban_comment / kanban_create / kanban_complete when the call text
# contains a secret-shaped value (Telegram bot token, key=value pairs, AWS key
# id, long hex-with-hint). Only rule ids are quoted in the block reason.
#
# This file is what a profile's config.yaml points at:
#
#   hooks:
#     pre_tool_call:
#       - matcher: "^(kanban_comment|kanban_create|kanban_complete)$"
#         command: "<profile>/agent-hooks/secret-guard.sh"
#         timeout: 30
#         fail_closed: true
#
# Install with scripts/qa/hooks/install-secret-guard.sh; verify with
# scripts/qa/hooks/verify-secret-guard.sh.
#
# Reads the Hermes hook payload on stdin, writes the decision JSON on stdout:
#   {"decision":"block","reason":...} + exit 2  → blocked
#   {}                                        + exit 0  → allowed
# Any internal failure fails closed (exit 2) because the config entry sets
# `fail_closed: true`.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
GATE="${SECRET_GUARD_SCRIPT:-${HOOK_DIR}/secret-guard.mjs}"

payload="$(cat)"

if ! command -v node >/dev/null 2>&1; then
  printf '{"decision":"block","reason":"secret-guard: node is not on PATH — failing closed."}\n'
  exit 2
fi

if [ ! -f "${GATE}" ]; then
  printf '{"decision":"block","reason":"secret-guard: gate script not found at %s — failing closed. Reinstall: scripts/qa/hooks/install-secret-guard.sh"}\n' "${GATE}"
  exit 2
fi

printf '%s' "${payload}" | node "${GATE}" hook
exit $?
