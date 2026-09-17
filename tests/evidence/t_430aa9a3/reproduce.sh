#!/usr/bin/env bash
# QA-001h (t_430aa9a3) — regenerate every evidence transcript in this directory.
#
# Run from the repo root:   bash tests/evidence/t_430aa9a3/reproduce.sh
# Nothing here mutates the board or any profile: the fixture board is built in a
# temp dir by the selftest, and the live fires point the hook at that fixture.
set -uo pipefail

OUT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${OUT}/../../.." && pwd)"
cd "${REPO_ROOT}"

PROFILE_HOME="${HERMES_PROFILES_HOME:-${HOME}/.hermes/profiles}"
FIXTURE_DIR="$(mktemp -d)"
FIXTURE_DB="${FIXTURE_DIR}/board.db"
FIXTURE_SQL="${FIXTURE_DIR}/fixture.sql"

echo "repo:        ${REPO_ROOT}"
echo "profile home: ${PROFILE_HOME}"
echo "fixture:     ${FIXTURE_DB}"
echo

# ── 1. selftest: every rule fires, every compliant control passes ────────────
{
  echo "# QA-001h evidence — gate selftest (33 cases: rules R1–R8 + advisory/hook paths)"
  echo "# command: node scripts/qa/signoff-gate.selftest.mjs"
  echo "# date:    $(date -u '+%Y-%m-%dT%H:%M:%SZ')  ·  node $(node -v)"
  echo
  node scripts/qa/signoff-gate.selftest.mjs --keep
  echo "exit=$?"
} > "${OUT}/selftest.txt" 2>&1

FIXTURE_ROOT="$(sed -n 's/.*fixture board: //p' "${OUT}/selftest.txt" | head -1)"
FIXTURE_ROOT="$(dirname "${FIXTURE_ROOT}")"
echo "fixture root parsed from selftest: ${FIXTURE_ROOT}"

# ── 2. audit of the rich fixture board (fails, with rule ids) ────────────────
{
  echo "# QA-001h evidence — audit of the non-vacuous fixture board"
  echo "# command: node scripts/qa/signoff-gate.mjs audit --db <fixture>/board.db --repo <fixture>/repo"
  echo "# date:    $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo
  node scripts/qa/signoff-gate.mjs audit --db "${FIXTURE_ROOT}/board.db" --repo "${FIXTURE_ROOT}/repo"
  echo "exit=$?"
  echo
  echo "# same board with --json (machine-readable; counts + per-card rule ids)"
  node scripts/qa/signoff-gate.mjs audit --db "${FIXTURE_ROOT}/board.db" --repo "${FIXTURE_ROOT}/repo" --json > "${FIXTURE_DIR}/audit.json"
  echo "exit=$?"
  python3 - "${FIXTURE_DIR}/audit.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print("ok:", d["ok"], "counts:", d["counts"])
for r in d["results"]:
    if r["facts"]["post_epoch"] and r["violations"]:
        print(f"  {r['facts']['task_id']}  {r['facts']['title']}")
        for v in r["violations"]:
            print(f"      {v['rule']}")
PY
} > "${OUT}/audit-fixture-board.txt" 2>&1

# ── 3. audit of the real board (baseline: nothing enforced yet) ──────────────
{
  echo "# QA-001h evidence — audit of the real Kanban board at activation"
  echo "# command: node scripts/qa/signoff-gate.mjs audit --db ~/.hermes/kanban.db"
  echo "# date:    $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "# epoch:   $(grep -m1 'GATE_EPOCH_ISO' scripts/qa/signoff-gate.mjs)"
  echo
  node scripts/qa/signoff-gate.mjs audit --db "${HOME}/.hermes/kanban.db" --repo "${REPO_ROOT}"
  echo "exit=$?"
  echo
  echo "# pre-epoch backlog under --strict-history (retrofit view; expected to be non-zero)"
  node scripts/qa/signoff-gate.mjs audit --db "${HOME}/.hermes/kanban.db" --repo "${REPO_ROOT}" --strict-history --json > "${FIXTURE_DIR}/strict.json"
  python3 - "${FIXTURE_DIR}/strict.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print("ok:", d["ok"], "counts:", d["counts"])
PY
} > "${OUT}/audit-real-board.txt" 2>&1

# ── 4. live fire through the Hermes hook dispatcher ─────────────────────────
sqlite3 "${FIXTURE_DB}" <<'SQL'
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT, completed_at INTEGER, created_at INTEGER);
CREATE TABLE task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
CREATE TABLE task_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, filename TEXT, stored_path TEXT, content_type TEXT, size INTEGER, uploaded_by TEXT, created_at INTEGER);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, summary TEXT, metadata TEXT, started_at INTEGER, ended_at INTEGER);
CREATE TABLE task_links (parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id));
INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('t_fx000001','FX-001 compliant fixture card','**Test Types:** unit','backend','done',1789660000,1789600000);
INSERT INTO task_comments (task_id,author,body,created_at) VALUES ('t_fx000001','qa','QA-VERDICT: pass — evidence: scripts/qa/signoff-gate.mjs (live-fire fixture)',1789660100);
INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES ('t_fx000002','FX-002 non-compliant fixture card','**Test Types:** unit','backend','running',NULL,1789600000);
SQL
printf '{"args":{"task_id":"t_fx000002","summary":"live fire"},"task_id":"t_fx000002"}\n' > "${FIXTURE_DIR}/bad.json"
printf '{"args":{"task_id":"t_fx000001","summary":"live fire"},"task_id":"t_fx000001"}\n' > "${FIXTURE_DIR}/good.json"

for profile_dir in "${PROFILE_HOME}"/*; do
  profile="$(basename "${profile_dir}")"
  {
    echo "# QA-001h evidence — live pre_tool_call fire for profile '${profile}'"
    echo "# date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo
    echo "## non-compliant card t_fx000002 (expect: blocked, exit 2, action:block)"
    echo "\$ HERMES_HOME=${profile_dir} HERMES_KANBAN_DB=${FIXTURE_DB} hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file payload-noncompliant.json"
    HERMES_HOME="${profile_dir}" HERMES_KANBAN_DB="${FIXTURE_DB}" hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file "${FIXTURE_DIR}/bad.json" 2>&1
    echo
    echo "## compliant card t_fx000001 (expect: allowed, exit 0, no dispatcher contribution)"
    HERMES_HOME="${profile_dir}" HERMES_KANBAN_DB="${FIXTURE_DB}" hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file "${FIXTURE_DIR}/good.json" 2>&1
  } > "${OUT}/live-fire-${profile}.txt" 2>&1
done

# ── 5. wiring: install (dry run) + config block + hooks list ────────────────
{
  echo "# QA-001h evidence — hook wiring (dry run; the real rollout transcript is hooks-rollout.txt)"
  echo "# date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo
  ./scripts/qa/hooks/install-signoff-gate.sh --profile qa
  echo "exit=$?"
  echo
  echo "# effective config block (profile: qa)"
  grep -A 8 '^hooks:' "${PROFILE_HOME}/qa/config.yaml"
  echo
  echo "# hermes hooks list (profile: qa)"
  HERMES_HOME="${PROFILE_HOME}/qa" hermes hooks list
  echo
  echo "# hermes hooks doctor (profile: qa)"
  HERMES_HOME="${PROFILE_HOME}/qa" hermes hooks doctor
  echo "exit=$?"
} > "${OUT}/hook-wiring.txt" 2>&1

# ── 6. verification of the installed hooks in every profile (live fires) ────
{
  echo "# QA-001h evidence — installed-hook verification across all profiles"
  echo "# date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "# requires: scripts/qa/hooks/install-signoff-gate.sh --all --apply has been run"
  echo
  ./scripts/qa/hooks/verify-signoff-gate.sh --all --live \
    --fixture-db "${FIXTURE_DB}" --fixture-noncompliant t_fx000002 --fixture-compliant t_fx000001
  echo "exit=$?"
} > "${OUT}/verify-all-live.txt" 2>&1
cp -f /tmp/signoff-gate-doctor-qa.txt "${OUT}/hooks-doctor-qa.txt" 2>/dev/null || true

echo "transcripts written to ${OUT}"
ls -1 "${OUT}"