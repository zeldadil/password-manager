#!/usr/bin/env bash
# t_338f47fd — re-install the gate in all 7 profiles and verify the installed copies.
#
# Produces the committed transcripts next to this script:
#   install-all-apply.txt   — `install-signoff-gate.sh --all --apply`
#   verify-all-live.txt     — `verify-signoff-gate.sh --all --live` (block + allow fired per profile)
#   installed-hashes.txt    — installed gate vs repo copy, sha256 per profile
#   hermes-hooks-doctor.txt — `hermes hooks doctor` per profile (expect the documented mtime warnings)
#
# Usage: bash tests/evidence/t_338f47fd/reinstall-and-verify.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
PROFILES_ROOT="${HERMES_PROFILES_ROOT:-${HOME}/.hermes/profiles}"
PROFILES="qa architect backend frontend docs product browser"
FIX="$(mktemp -d "${TMPDIR:-/tmp}/signoff-verify-338f47fd.XXXXXX")"

cd "$REPO_ROOT"

note_header() { printf '%s\n' "$1"; }

# ── install ──────────────────────────────────────────────────────────────────
{
  note_header "t_338f47fd — re-install the gate hook in every profile (§3 author rule for VERDICT_MARKER_RE)"
  note_header "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  note_header "repo gate copy: scripts/qa/signoff-gate.mjs sha256 $(sha256sum scripts/qa/signoff-gate.mjs | cut -d' ' -f1)"
  note_header "selftest copy:  scripts/qa/signoff-gate.selftest.mjs sha256 $(sha256sum scripts/qa/signoff-gate.selftest.mjs | cut -d' ' -f1)"
  note_header "command: bash scripts/qa/hooks/install-signoff-gate.sh --all --apply"
  note_header ""
  bash scripts/qa/hooks/install-signoff-gate.sh --all --apply 2>&1
} > "$HERE/install-all-apply.txt" 2>&1

# ── verifier fixture board + repo ────────────────────────────────────────────
mkdir -p "$FIX/repo/tests/evidence/t_aaaaaaaa" "$FIX/repo/tests/evidence/t_dddddddd"
printf 'synthetic verifier fixture evidence — no real data\n' > "$FIX/repo/tests/evidence/t_aaaaaaaa/README.md"
printf 'synthetic verifier fixture evidence — no real data\n' > "$FIX/repo/tests/evidence/t_dddddddd/README.md"
git -C "$FIX/repo" init -q -b main
git -C "$FIX/repo" config user.email fixture@example.invalid
git -C "$FIX/repo" config user.name "gate fixture"
git -C "$FIX/repo" add -A
git -C "$FIX/repo" commit -qm "verifier fixture repo"
sqlite3 "$FIX/board.db" <<SQL
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT, completed_at INTEGER, created_at INTEGER);
CREATE TABLE task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
CREATE TABLE task_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, filename TEXT, stored_path TEXT, content_type TEXT, size INTEGER, uploaded_by TEXT, created_at INTEGER);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, summary TEXT, metadata TEXT, started_at INTEGER, ended_at INTEGER);
CREATE TABLE task_links (parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id));
INSERT INTO tasks (id,title,body,assignee,status,completed_at,created_at) VALUES
 ('t_aaaaaaaa','Verifier fixture — compliant card','**Test Types:** unit','backend','running',NULL,1789600000),
 ('t_bbbbbbbb','Verifier fixture — non-compliant card','**Test Types:** unit','backend','running',NULL,1789600000),
 ('t_cccccccc','Verifier fixture — non-QA marker comment (t_338f47fd)','**Test Types:** unit','backend','running',NULL,1789600000),
 ('t_dddddddd','Verifier fixture — the same marker comment authored by qa','**Test Types:** unit','backend','running',NULL,1789600000);
INSERT INTO task_comments (task_id,author,body,created_at) VALUES
 ('t_aaaaaaaa','qa','QA-VERDICT: pass — verifier fixture. Evidence: tests/evidence/t_aaaaaaaa/README.md',1789660000),
 ('t_cccccccc','architect','QA-VERDICT: pass — a non-QA author may not record this. Evidence: tests/evidence/t_dddddddd/README.md',1789660001),
 ('t_dddddddd','qa','QA-VERDICT: pass — a non-QA author may not record this. Evidence: tests/evidence/t_dddddddd/README.md',1789660002);
SQL

# ── verify (structural + live fire per profile) ──────────────────────────────
{
  note_header "t_338f47fd — structural + live verification of the installed hook (7 profiles)"
  note_header "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  note_header "fixture board: $FIX/board.db (compliant t_aaaaaaaa, non-compliant t_bbbbbbbb, non-QA marker t_cccccccc)"
  note_header "fixture repo:  $FIX/repo (holds tests/evidence/t_aaaaaaaa/README.md)"
  note_header "command: bash scripts/qa/hooks/verify-signoff-gate.sh --all --live \\"
  note_header "           --fixture-db $FIX/board.db --fixture-noncompliant t_bbbbbbbb \\"
  note_header "           --fixture-compliant t_aaaaaaaa --fixture-repo $FIX/repo"
  note_header ""
  bash scripts/qa/hooks/verify-signoff-gate.sh --all --live \
    --fixture-db "$FIX/board.db" --fixture-noncompliant t_bbbbbbbb \
    --fixture-compliant t_aaaaaaaa --fixture-repo "$FIX/repo" 2>&1
} > "$HERE/verify-all-live.txt" 2>&1

# ── installed hashes ─────────────────────────────────────────────────────────
{
  note_header "t_338f47fd — installed gate vs repo copy"
  note_header "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  note_header "repo copy: scripts/qa/signoff-gate.mjs sha256 $(sha256sum scripts/qa/signoff-gate.mjs | cut -d' ' -f1)"
  note_header ""
  real=0
  for p in $PROFILES; do
    f="${PROFILES_ROOT}/${p}/agent-hooks/signoff-gate.mjs"
    h="$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)"
    r="$(sha256sum scripts/qa/signoff-gate.mjs | cut -d' ' -f1)"
    if [ "$h" = "$r" ] && [ -n "$h" ]; then
      printf 'ok   %-10s %s\n' "$p" "$h"
    else
      printf 'FAIL %-10s %s\n' "$p" "${h:-missing}"
      real=1
    fi
  done
  printf '\nresult: %s\n' "$([ "$real" -eq 0 ] && echo 'all 7 installed copies match the repo copy' || echo 'DRIFT')"
} > "$HERE/installed-hashes.txt" 2>&1

# ── hermes hooks doctor (expected mtime-drift warnings) ──────────────────────
{
  note_header "t_338f47fd — hermes hooks doctor per profile"
  note_header "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  note_header "Note: after every install, doctor reports 'script modified since approval' for each of the two"
  note_header "hooks a profile carries (sign-off gate + secret guard). The approval refresh is interactive-only,"
  note_header "so a headless re-install cannot clear it — QA_SIGN_OFF_GATE.md §8.1 documents this as expected."
  note_header ""
  for p in $PROFILES; do
    note_header "── ${p} (${PROFILES_ROOT}/${p})"
    HERMES_HOME="${PROFILES_ROOT}/${p}" hermes hooks doctor 2>&1
    note_header ""
  done
} > "$HERE/hermes-hooks-doctor.txt" 2>&1

# ── live fire of the §3 author rule through the REAL dispatcher path ─────────
# Same comment text on both cards; the only difference is the author. Fired per
# profile with `hermes hooks test` (the dispatcher path), from the fixture repo so
# the evidence path resolves.
{
  note_header "t_338f47fd — live fire: the §3 author rule through the real hook path"
  note_header "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  note_header "fixture board: $FIX/board.db"
  note_header "fixture repo:  $FIX/repo"
  note_header ""
  note_header "t_cccccccc  marker written by architect  → must BLOCK with R1_QA_VERDICT_MISSING"
  note_header "t_dddddddd  the same marker written by qa → must ALLOW ({} , exit 0)"
  note_header ""
  bad_payload="$(mktemp)"
  good_payload="$(mktemp)"
  printf '{"args":{"task_id":"t_cccccccc","summary":"author-rule fire"},"task_id":"t_cccccccc"}\n' > "$bad_payload"
  printf '{"args":{"task_id":"t_dddddddd","summary":"author-rule fire"},"task_id":"t_dddddddd"}\n' > "$good_payload"
  blocked=0
  allowed=0
  for p in $PROFILES; do
    pd="${PROFILES_ROOT}/${p}"
    note_header "── ${p} (${pd})"
    bad_out="$( ( cd "$FIX/repo" && HERMES_HOME="$pd" HERMES_KANBAN_DB="$FIX/board.db" hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file "$bad_payload" 2>&1 ) )"
    good_out="$( ( cd "$FIX/repo" && HERMES_HOME="$pd" HERMES_KANBAN_DB="$FIX/board.db" hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file "$good_payload" 2>&1 ) )"
    if printf '%s' "$bad_out" | grep -q '"action": "block"' && printf '%s' "$bad_out" | grep -q 'R1_QA_VERDICT_MISSING'; then
      note_header "   ok   architect-authored marker → block + R1"
      blocked=$((blocked + 1))
    else
      note_header "   FAIL architect-authored marker did NOT block with R1:"
      printf '%s\n' "$bad_out" | tail -6 | sed 's/^/        /'
    fi
    if printf '%s' "$good_out" | grep -q 'exit=0' && printf '%s' "$good_out" | grep -q 'parsed: <none'; then
      note_header "   ok   qa-authored marker → allow (no dispatcher contribution)"
      allowed=$((allowed + 1))
    else
      note_header "   FAIL qa-authored marker did not allow:"
      printf '%s\n' "$good_out" | tail -6 | sed 's/^/        /'
    fi
    note_header "        block reason: $(printf '%s' "$bad_out" | grep -o 'QA sign-off gate blocked this completion[^"]*' | head -1 | cut -c1-160)"
    note_header ""
  done
  rm -f "$bad_payload" "$good_payload"
  note_header "result: ${blocked}/7 profiles blocked the non-QA marker, ${allowed}/7 allowed the qa marker"
} > "$HERE/hook-live-fire-author-rule.txt" 2>&1

tail -6 "$HERE/installed-hashes.txt"
grep -c '^   ok' "$HERE/verify-all-live.txt" 2>/dev/null | sed 's/^/verifier ok lines: /'
tail -3 "$HERE/verify-all-live.txt"
rm -rf "$FIX"
