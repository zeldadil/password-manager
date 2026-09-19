#!/usr/bin/env bash
# t_df8e644a — build the throwaway fixture board + repo the profile verifier fires against.
#
#   t_aaaaaaaa  compliant card  (qa verdict + committed evidence path in the fixture repo)
#   t_bbbbbbbb  non-compliant card (no verdict, no evidence) → the live fire must return block
#
# Usage: bash make-verify-fixture.sh <dir>
set -euo pipefail
fix="${1:?usage: make-verify-fixture.sh <dir>}"
mkdir -p "${fix}/repo/tests/evidence/t_aaaaaaaa"
rm -f "${fix}/board.db"
cat > "${fix}/board.sql" <<'SQL'
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT, completed_at INTEGER, created_at INTEGER);
CREATE TABLE task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
CREATE TABLE task_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, filename TEXT, stored_path TEXT, content_type TEXT, size INTEGER, uploaded_by TEXT, created_at INTEGER);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, summary TEXT, metadata TEXT, started_at INTEGER, ended_at INTEGER);
CREATE TABLE task_links (parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id));
INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES
 ('t_aaaaaaaa','Verifier fixture — compliant card','**Test Types:** unit','backend','running',NULL,1789600000),
 ('t_bbbbbbbb','Verifier fixture — non-compliant card','**Test Types:** unit','backend','running',NULL,1789600000);
INSERT INTO task_comments (task_id,author,body,created_at) VALUES
 ('t_aaaaaaaa','qa','QA-VERDICT: pass — verifier fixture. Evidence: tests/evidence/t_aaaaaaaa/README.md',1789660000);
SQL
sqlite3 "${fix}/board.db" < "${fix}/board.sql"
echo "synthetic verifier fixture evidence — no real data" > "${fix}/repo/tests/evidence/t_aaaaaaaa/README.md"
git -C "${fix}/repo" init -q -b main
git -C "${fix}/repo" config user.email fixture@example.invalid
git -C "${fix}/repo" config user.name "gate fixture"
git -C "${fix}/repo" add -A
git -C "${fix}/repo" commit -qm "verifier fixture repo"
echo "fixture board: ${fix}/board.db"
echo "fixture repo : ${fix}/repo"
