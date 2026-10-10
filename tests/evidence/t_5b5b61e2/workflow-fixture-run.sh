#!/usr/bin/env bash
# t_5b5b61e2 — criterion "ci": run the workflow's OWN step bodies, extracted verbatim from
# .github/workflows/qa-signoff-audit.yml, the way a runner would:
#   F. the new PR job `bypass-report-fixture` ("Gate selftest (keeps its fixture root)" +
#      "Audit the synthetic bypass board")                       → expect both steps exit 0
#   L. the scheduled job's "Run the board audit" + "Write the run summary" + "Enforce the
#      audit outcome" on a read-only snapshot of the live board, GitHub off → the bypass block
#      is in the summary; the colour is the audit's own (29 existing FAILs + A11 → red,
#      unrelated to this card); the bypasses add no failure.
# plus actionlint on the workflow. RUNNER_TEMP / GITHUB_OUTPUT / GITHUB_STEP_SUMMARY /
# GITHUB_WORKSPACE are simulated. Live-board outputs are kept OUT of the committed evidence
# except for the summary's counter + trend rows (free-text reasons stay on the host).
# Usage: NODE_BIN=<dir with node 22> bash tests/evidence/t_5b5b61e2/workflow-fixture-run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
WF="${REPO}/.github/workflows/qa-signoff-audit.yml"
EXTRACT="${REPO}/tests/evidence/t_b102b100/extract-step.py"
OUT="${HERE}/workflow"
SCRATCH="${TMPDIR:-/home/sap/.hermes/profiles/qa/cache/scratch}/t_5b5b61e2-wf"
mkdir -p "${OUT}" "${SCRATCH}"
if [ -n "${NODE_BIN:-}" ]; then export PATH="${NODE_BIN}:${PATH}"; fi
cd "${REPO}"
echo "node $(node --version)" > "${OUT}/env.txt"
actionlint --version | head -1 >> "${OUT}/env.txt"

actionlint "${WF}" > "${OUT}/actionlint.txt" 2>&1
echo "exit=$?" >> "${OUT}/actionlint.txt"

python3 "${EXTRACT}" "${WF}" "Gate selftest (keeps its fixture root)" > "${SCRATCH}/step-selftest.sh"
python3 "${EXTRACT}" "${WF}" "Audit the synthetic bypass board" > "${SCRATCH}/step-bypass.sh"
python3 "${EXTRACT}" "${WF}" "Run the board audit" > "${SCRATCH}/step-audit.sh"
python3 "${EXTRACT}" "${WF}" "Write the run summary" > "${SCRATCH}/step-summary.sh"
python3 "${EXTRACT}" "${WF}" "Enforce the audit outcome" > "${SCRATCH}/step-enforce.sh"
sed -i 's/\${{ steps.board.outputs.available }}/true/' "${SCRATCH}/step-enforce.sh"

# ── F: the PR job, on its own fixture ───────────────────────────────────────
F="${SCRATCH}/F"
rm -rf "${F}"
mkdir -p "${F}"
: > "${F}/step_summary.md"; : > "${F}/output.txt"
envF=(RUNNER_TEMP="${F}" GITHUB_OUTPUT="${F}/output.txt" GITHUB_STEP_SUMMARY="${F}/step_summary.md" GITHUB_WORKSPACE="${REPO}")
env "${envF[@]}" bash "${SCRATCH}/step-selftest.sh" > "${F}/step-selftest.log" 2>&1; fs=$?
root="$(sed -n 's/^root=//p' "${F}/output.txt")"
env "${envF[@]}" FIXTURE_ROOT="${root}" bash "${SCRATCH}/step-bypass.sh" > "${F}/step-bypass.log" 2>&1; fb=$?
{
  echo "job=bypass-report-fixture selftest_step_exit=${fs} bypass_step_exit=${fb} fixture_root_found=$([ -d "${root}" ] && echo yes || echo no)"
  echo "--- selftest tail ---"
  tail -2 "${F}/step-selftest.log"
  echo "--- annotations printed by the summary script ---"
  grep -E '^::(warning|notice) ' "${F}/step-bypass.log"
} > "${OUT}/F-pr-job.txt"
cp "${F}/step_summary.md" "${OUT}/F-pr-job.step_summary.md"

# ── L: the scheduled job's steps on a live-board snapshot, GitHub off ───────
L="${SCRATCH}/L"
rm -rf "${L}"
mkdir -p "${L}"
LIVE="${SCRATCH}/board-snapshot.db"
sqlite3 /home/sap/.hermes/kanban.db ".backup '${LIVE}'"
: > "${L}/step_summary.md"; : > "${L}/output.txt"
envL=(RUNNER_TEMP="${L}" GITHUB_OUTPUT="${L}/output.txt" GITHUB_STEP_SUMMARY="${L}/step_summary.md" GITHUB_WORKSPACE="${REPO}"
  BOARD_DB="${LIVE}" STRICT_HISTORY=false GIT_REF=refs/heads/master GH_EVENT_NAME=workflow_dispatch QA_GATE_GITHUB=off)
env "${envL[@]}" bash "${SCRATCH}/step-audit.sh" > "${L}/step-audit.log" 2>&1; la=$?
env "${envL[@]}" bash "${SCRATCH}/step-summary.sh" > "${L}/step-summary.log" 2>&1; ls_=$?
env "${envL[@]}" bash "${SCRATCH}/step-enforce.sh" > "${L}/step-enforce.log" 2>&1; le=$?
{
  echo "job=qa-signoff-audit (live snapshot, GitHub off) audit_step_exit=${la} summary_step_exit=${ls_} enforce_step_exit=${le}"
  echo "annotations: warning=$(grep -c '^::warning ' "${L}/step-summary.log") notice=$(grep -c '^::notice ' "${L}/step-summary.log")"
  echo "--- run summary: counter table + trend table (per-occurrence rows with free-text reasons NOT committed) ---"
  sed -n '/^### Bypasses and degradations/,/^#### /p' "${L}/step_summary.md" | sed '$d'
  echo "--- per-type section headings ---"
  grep -E '^#### ' "${L}/step_summary.md"
  echo "--- X1 rows: date | card | author | state (reason column dropped) ---"
  sed -n '/^#### `X1_EXCEPTION`/,/^#### \|^### /p' "${L}/step_summary.md" | grep -E '^\| [0-9]{4}-' | awk -F' \\| ' '{print $1" | "$2" | "$4" | "$6}'
} > "${OUT}/L-live-snapshot.txt"
sed -i "s#${SCRATCH}#<scratch>#g; s#${REPO}#<repo>#g; s#${root}#<selftest-root>#g" "${OUT}"/*.txt "${OUT}"/*.md
cat "${OUT}/F-pr-job.txt" | head -5
head -3 "${OUT}/L-live-snapshot.txt"
cat "${OUT}/actionlint.txt"
