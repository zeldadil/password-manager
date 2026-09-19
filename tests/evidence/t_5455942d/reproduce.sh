#!/usr/bin/env bash
# t_5455942d — reproduce the QA sign-off gate defect fix (fail-closed on unverifiable input only).
#
# Runs, from a checkout of the branch that carries the fix:
#   1. the gate selftest (non-vacuity matrix: every rule still fires, every control clean)
#   2. the three live hook payloads against the INSTALLED hook of the qa profile
#   3. `check --pre-complete` on the real board for t_0af5aa3e against a repo root that holds
#      only the operative verdict's evidence (the R5 / deferral-heuristic regressions)
#   4. optional: the profile verifier (`--verify`), which needs a fixture board
#
# The pre-fix behaviour is recorded in prefix-transcript.txt; to reproduce it, check out the
# parent commit (feature/t_430aa9a3) and run the same payloads — the id chain then resolves
# the *session id* and the hook blocks with
#   signoff-gate: task 20260917_201256_021f5e is not on the board at ~/.hermes/kanban.db.
#
# Usage: bash tests/evidence/t_5455942d/reproduce.sh [--verify]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
GATE="${REPO}/scripts/qa/signoff-gate.mjs"
SELFTEST="${REPO}/scripts/qa/signoff-gate.selftest.mjs"
HOOK="${SIGNOFF_GATE_HOOK:-${HOME}/.hermes/profiles/qa/agent-hooks/qa-signoff-gate.sh}"
DB_PATH="${HERMES_KANBAN_DB:-${HOME}/.hermes/kanban.db}"
CARD="${1:-t_0af5aa3e}"
SESSION_ID="20260917_201256_021f5e"

work="$(mktemp -d)"
fixture="${work}/repo-operative-only"
mkdir -p "${fixture}/tests/evidence/${CARD}"
printf 'operative-verdict evidence stand-in for %s\n' "${CARD}" > "${fixture}/tests/evidence/${CARD}/QA-VERDICT-ROTATION.md"

echo "== 1. selftest (fixture board, non-vacuity matrix) =="
node "${SELFTEST}" || echo "   selftest FAILED"

echo
echo "== 2. live hook payloads against ${HOOK} =="
payload="${work}/session.json"
printf '{"hook_event_name":"pre_tool_call","tool_name":"kanban_complete","tool_input":{"summary":"no explicit task_id"},"session_id":"%s","cwd":"/home/sap","profile":"qa","extra":{"task_id":"%s"}}\n' \
  "${SESSION_ID}" "${SESSION_ID}" > "${payload}"

echo "-- 2a. the real dispatcher-worker env: no HERMES_KANBAN_TASK (Hermes scrubs it for hook"
echo "       subprocesses), HERMES_KANBAN_WORKSPACE=<workspaces>/${CARD} → id resolves, then the"
echo "       gate judges ${CARD} on its merits (R1/R4 if it has no verdict yet):"
env -u HERMES_KANBAN_TASK HERMES_KANBAN_WORKSPACE="${HOME}/.hermes/kanban/workspaces/${CARD}" \
  HERMES_KANBAN_DB="${DB_PATH}" bash "${HOOK}" < "${payload}"
echo "   exit=$?"

echo "-- 2b. session id, neutral cwd, no kanban env → still fails closed, naming every source:"
env -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE -u HERMES_KANBAN_BRANCH \
  HERMES_KANBAN_DB="${DB_PATH}" bash "${HOOK}" < "${payload}"
echo "   exit=$?"

echo
echo "== 3. check --pre-complete ${CARD} against a repo root holding only the operative evidence =="
node "${GATE}" check --task "${CARD}" --pre-complete --repo "${fixture}"
echo "   exit=$?"

if [ "${2:-}" = "--verify" ] || [ "${1:-}" = "--verify" ]; then
  echo
  echo "== 4. profile verifier (needs --fixture-db / --fixture-noncompliant / --fixture-compliant / --fixture-repo) =="
  echo "   generate fixtures with: node scripts/qa/signoff-gate.selftest.mjs --keep"
  echo "   then: bash scripts/qa/hooks/verify-signoff-gate.sh --all --live \\"
  echo "           --fixture-db <tmp>/board.db --fixture-noncompliant t_b000000b \\"
  echo "           --fixture-compliant t_b0000000 --fixture-repo <tmp>/repo"
fi

echo
echo "work dir kept for inspection: ${work}"
