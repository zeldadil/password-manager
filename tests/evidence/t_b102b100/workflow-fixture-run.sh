#!/usr/bin/env bash
# t_b102b100 — criterion 3 (ci): run the workflow's OWN step bodies from
# .github/workflows/qa-signoff-audit.yml ("Run the board audit", "Write the run
# summary", "Enforce the audit outcome"), extracted verbatim, against:
#   A. the selftest's A11-only fixture board, GitHub unreachable  → expect red (exit 1)
#   B. the same fixture board, GitHub reachable (no A11)          → expect green (exit 0)
#   C. a read-only snapshot of the live board, GitHub live (gh authenticated on this host)
#   D. the same snapshot, GitHub off (QA_GATE_GITHUB=off)          → every in-scope card A11 → red
# plus actionlint on the workflow. The GitHub runner environment is simulated
# with RUNNER_TEMP / GITHUB_OUTPUT / GITHUB_STEP_SUMMARY / GITHUB_WORKSPACE.
# Usage: NODE_BIN=<dir with node 22> bash tests/evidence/t_b102b100/workflow-fixture-run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
WF="${REPO}/.github/workflows/qa-signoff-audit.yml"
OUT="${HERE}/workflow"
SCRATCH="${TMPDIR:-/home/sap/.hermes/profiles/qa/cache/scratch}/t_b102b100-wf"
mkdir -p "${OUT}" "${SCRATCH}"
if [ -n "${NODE_BIN:-}" ]; then export PATH="${NODE_BIN}:${PATH}"; fi
cd "${REPO}"
echo "node $(node --version)" > "${OUT}/env.txt"
actionlint --version | head -1 >> "${OUT}/env.txt"

actionlint "${WF}" > "${OUT}/actionlint.txt" 2>&1
echo "exit=$?" >> "${OUT}/actionlint.txt"

python3 "${HERE}/extract-step.py" "${WF}" "Run the board audit" > "${SCRATCH}/step-audit.sh"
python3 "${HERE}/extract-step.py" "${WF}" "Write the run summary" > "${SCRATCH}/step-summary.sh"
python3 "${HERE}/extract-step.py" "${WF}" "Enforce the audit outcome" > "${SCRATCH}/step-enforce.sh"
# The only expression inside a run: body; the board was resolved in every scenario.
sed -i 's/\${{ steps.board.outputs.available }}/true/' "${SCRATCH}/step-enforce.sh"
grep -c 'fail-on-a11' "${SCRATCH}/step-audit.sh" > "${OUT}/step-audit-has-fail-on-a11.txt"

# Fixture board: the selftest's own A11-only board (section 9), kept with --keep.
before="$(ls -d "${TMPDIR:-/tmp}"/signoff-gate-selftest-* 2>/dev/null | sort)"
node scripts/qa/signoff-gate.selftest.mjs --keep > "${SCRATCH}/selftest-keep.txt" 2>&1
after="$(ls -d "${TMPDIR:-/tmp}"/signoff-gate-selftest-* 2>/dev/null | sort)"
FIX="$(comm -13 <(printf '%s\n' "${before}") <(printf '%s\n' "${after}") | tail -1)"
[ -n "${FIX}" ] || { echo "no kept selftest root" >&2; exit 2; }

# Live board snapshot (read-only .backup; the live board is never written).
LIVE="${SCRATCH}/board-snapshot.db"
sqlite3 /home/sap/.hermes/kanban.db ".backup '${LIVE}'"

run_scenario() {
  local name="$1" db="$2" ws="$3"; shift 3
  local rt="${SCRATCH}/${name}"
  mkdir -p "${rt}"
  : > "${rt}/step_summary.md"; : > "${rt}/output.txt"
  local envs=(RUNNER_TEMP="${rt}" GITHUB_OUTPUT="${rt}/output.txt" GITHUB_STEP_SUMMARY="${rt}/step_summary.md"
    GITHUB_WORKSPACE="${ws}" BOARD_DB="${db}" STRICT_HISTORY=false GIT_REF=refs/heads/master GH_EVENT_NAME=workflow_dispatch "$@")
  env "${envs[@]}" bash "${SCRATCH}/step-audit.sh" > "${rt}/step-audit.log" 2>&1; local a=$?
  env "${envs[@]}" bash "${SCRATCH}/step-summary.sh" > "${rt}/step-summary.log" 2>&1; local s=$?
  env "${envs[@]}" bash "${SCRATCH}/step-enforce.sh" > "${rt}/step-enforce.log" 2>&1; local e=$?
  local w; w="$(grep -c '^::warning ' "${rt}/step-summary.log")"
  {
    echo "scenario=${name} audit_step_exit=${a} summary_step_exit=${s} enforce_step_exit=${e} warning_annotations=${w}"
    echo "--- audit header (first 6 lines of the report) ---"
    sed -n 2,7p "${rt}/qa-signoff-audit.txt"
    echo "--- ::warning:: annotations (first 5) ---"
    grep '^::warning ' "${rt}/step-summary.log" | head -5
    echo "--- step summary: Bypasses and degradations section ---"
    sed -n '/^### Bypasses and degradations/,/^### Audit report/p' "${rt}/step_summary.md" | sed '$d'
  } > "${OUT}/${name}.txt"
  cp "${rt}/step_summary.md" "${OUT}/${name}.step_summary.md"
  echo "${name}: audit=${a} summary=${s} enforce=${e} warnings=${w}"
}

run_scenario A-fixture-a11-only "${FIX}/board-a11.db" "${FIX}/repo" QA_GATE_GITHUB_FIXTURE="${FIX}/gh-unreachable.json"
run_scenario B-fixture-no-a11 "${FIX}/board-a11.db" "${FIX}/repo" QA_GATE_GITHUB_FIXTURE="${FIX}/gh-empty.json"
run_scenario C-live-board-github-live "${LIVE}" "${REPO}"
run_scenario D-live-board-github-off "${LIVE}" "${REPO}" QA_GATE_GITHUB=off

# Paths are host-specific; keep the evidence readable and reproducible.
sed -i "s#${FIX}#<selftest-root>#g; s#${SCRATCH}#<scratch>#g; s#${REPO}#<repo>#g" "${OUT}"/*.txt "${OUT}"/*.md
