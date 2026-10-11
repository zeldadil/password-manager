#!/usr/bin/env bash
# SEC-GATE / t_30e17642 — Hermes `pre_tool_call` shell hook: merge-guard.
#
# Refuses GitHub pull-request merges (`gh pr merge`, `gh api … pulls/<n>/merge`,
# `-X PUT …/merge`, GraphQL merge mutations, the MCP merge_pull_request tool) from
# every profile EXCEPT architect: the merge belongs to architect
# (QA_SIGN_OFF_GATE.md §5.9). Read-only `gh pr view/checks/list`, `gh pr create`,
# `git merge-base` and a local `git merge` stay allowed.
#
# This file is what a profile's config.yaml points at:
#
#   hooks:
#     pre_tool_call:
#       - matcher: "^(terminal|process_manage|execute_code|tool_call|mcp__.*merge.*)$"
#         command: "<profile>/agent-hooks/merge-guard.sh"
#         timeout: 15
#         fail_closed: true
#
# Install with scripts/qa/hooks/install-merge-guard.sh (refuses `architect`);
# verify with scripts/qa/hooks/verify-merge-guard.sh.
#
# Reads the Hermes hook payload on stdin, writes the decision JSON on stdout:
#   {"decision":"block","reason":...} + exit 2  → blocked
#   {}                                        + exit 0  → allowed
# Any internal failure fails closed (exit 2). There is no kill-switch file on
# purpose: any agent could create it. Rollback = remove the config entry.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
GATE="${MERGE_GUARD_SCRIPT:-${HOOK_DIR}/merge-guard.mjs}"

payload="$(cat)"

if ! command -v node >/dev/null 2>&1; then
  printf '{"decision":"block","reason":"merge-guard: node is not on PATH — failing closed (le merge revient à architect, QA_SIGN_OFF_GATE.md §5.9)."}\n'
  exit 2
fi

if [ ! -f "${GATE}" ]; then
  printf '{"decision":"block","reason":"merge-guard: gate script not found at %s — failing closed (le merge revient à architect, QA_SIGN_OFF_GATE.md §5.9). Reinstall: scripts/qa/hooks/install-merge-guard.sh"}\n' "${GATE}"
  exit 2
fi

printf '%s' "${payload}" | node "${GATE}" hook
exit $?
