#!/usr/bin/env bash
# t_99e408c5 — reproduce the QA-001i-fu6 fix end to end.
#
# The defect: `R5_EVIDENCE_FILE_MISSING` failed a card for a path its *operative
# verdict merely quoted* about another card (`t_7dd3b960` reported a broken
# evidence pointer on `t_28f60dc1` and was then failed for naming
# `tests/evidence/t_28f60dc1/README.md`). The fix (QA_SIGN_OFF_GATE.md §5.7):
# R5 resolves only the paths the operative verdict *claims* (inside an
# `Evidence:`/`Artifacts:` label, or outside code spans/fences when it carries
# no label); a quoted path is a *citation* reported as `A6_EVIDENCE_CITED`.
#
# Usage:  bash tests/evidence/t_99e408c5/reproduce.sh [--full]
#
#   without --full : hashes · patched selftest · prefix-gate A/B (selftest) ·
#                    live-board replay + control · installed-copy hash equality
#   with --full    : additionally re-installs the gate in all 7 profiles and runs
#                    scripts/qa/hooks/verify-signoff-gate.sh --all --live
#
# Every step prints what it expects; the script exits 1 if an expectation is not
# met. Nothing here writes to the live board (the replay works on a copy).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
GATE="${REPO_ROOT}/scripts/qa/signoff-gate.mjs"
SELFTEST="${REPO_ROOT}/scripts/qa/signoff-gate.selftest.mjs"
PREFIX_REF="${PREFIX_REF:-origin/qa/t_58280940-r8-stale-deferral}"  # revision installed before this fix
BOARD="${HERMES_KANBAN_DB:-${HOME}/.hermes/kanban.db}"
BOARD_CARD="${BOARD_CARD:-t_7dd3b960}"
CONTROL_CARD="${CONTROL_CARD:-t_28f60dc1}"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

fails=0
ok()   { printf 'ok   %s\n' "$1"; }
bad()  { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
note() { printf '\n── %s\n' "$1"; }

note "0. revisions under test"
sha() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
printf 'repo gate    %s  %s\n' "$(sha "$GATE")" "$GATE"
printf 'selftest     %s\n' "$(sha "$SELFTEST")"
printf 'gate doc     %s\n' "$(sha "${REPO_ROOT}/QA_SIGN_OFF_GATE.md")"
# The prefix gate (the revision installed before this fix) is read from git so the
# A/B needs no committed copy of old logic. Fallbacks keep this runnable from a
# fresh clone after the branch that carried it is deleted.
PREFIX_SOURCE=""
PREFIX_GATE=""
for ref in "$PREFIX_REF" "$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)^" origin/master; do
  [ -n "$ref" ] || continue
  PREFIX_GATE="$(git -C "$REPO_ROOT" show "${ref}:scripts/qa/signoff-gate.mjs" 2>/dev/null || true)"
  if [ -n "$PREFIX_GATE" ]; then PREFIX_SOURCE="$ref"; break; fi
done
if [ -n "$PREFIX_GATE" ]; then
  printf 'prefix gate  %s  (%s — the revision installed before this fix)\n' \
    "$(printf '%s' "$PREFIX_GATE" | sha256sum | cut -d' ' -f1)" "$PREFIX_SOURCE"
else
  printf 'prefix gate  UNAVAILABLE (no usable git ref in this clone)\n'
fi

note "1. selftest against the fixed gate — expect 66/66 and exit 0"
out="$(cd "$REPO_ROOT" && node scripts/qa/signoff-gate.selftest.mjs 2>&1)"; rc=$?
printf '%s\n' "$out" | tail -3
if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q "66/66 cases passed"; then ok "patched selftest 66/66"; else bad "patched selftest (exit=$rc)"; fi

note "2. A/B: the same 66 cases against the prefix gate — expect the t_99e408c5 cases to FAIL"
if [ -n "$PREFIX_GATE" ]; then
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/scripts/qa"
  cp "$SELFTEST" "${tmp}/scripts/qa/"
  printf '%s' "$PREFIX_GATE" > "${tmp}/scripts/qa/signoff-gate.mjs"
  out="$(node "${tmp}/scripts/qa/signoff-gate.selftest.mjs" 2>&1)"; rc=$?
  printf '%s\n' "$out" | tail -8
  n="$(printf '%s\n' "$out" | grep -c '^  FAIL - ')"
  missing=""
  for label in \
    "a verdict quoting another card's missing path is NOT blocked by R5" \
    "the quoted path is reported as A6_EVIDENCE_CITED" \
    "no label: a quoted path in a code span is a citation" \
    "the reporting card's own labelled evidence stays the claim it resolves"; do
    printf '%s' "$out" | grep -q "FAIL - ${label}" || missing="${missing} · ${label}"
  done
  if [ $rc -eq 1 ] && [ -z "$missing" ]; then
    ok "prefix gate fails the t_99e408c5 cases (RED, ${n} total) and still passes the rest — including the three R5 controls (anti-vacuity)"
  else
    bad "prefix-gate A/B: exit=$rc failures=${n} not-reproduced=[${missing}]"
  fi
  rm -rf "$tmp"
else
  bad "prefix-gate A/B skipped — fetch ${PREFIX_REF} first"
fi

note "3. live-board replay of the reported instance (works on a COPY of the board)"
if [ -f "$BOARD" ]; then
  cid="$(sqlite3 "$BOARD" "SELECT id FROM task_comments WHERE task_id='${BOARD_CARD}' AND body LIKE '%t_28f60dc1%' ORDER BY created_at DESC LIMIT 1;")"
  if [ -n "$cid" ]; then
    snap="$(mktemp -d)/board-replay.db"
    cp "$BOARD" "$snap"
    # make the quoted-path verdict operative again, without touching live data
    sqlite3 "$snap" "INSERT INTO task_comments (task_id,author,body,created_at) SELECT task_id,author,body,(SELECT MAX(created_at)+1 FROM task_comments) FROM task_comments WHERE id=${cid};"
    printf 'replayed comment #%s as the newest record on %s\n' "$cid" "$BOARD_CARD"
    printf 'the quoted path exists on a ref? '
    if [ -n "$(git -C "$REPO_ROOT" rev-list --max-count=1 --all -- "tests/evidence/${CONTROL_CARD}/README.md")" ]; then
      printf 'yes (this check is about the citation rule, not about absence)\n'
    else
      printf 'no — absent from every ref, exactly like the reported instance\n'
    fi
    if [ -n "$PREFIX_GATE" ]; then
      gdir="$(mktemp -d)"; printf '%s' "$PREFIX_GATE" > "${gdir}/gate.mjs"
      out="$(cd "$REPO_ROOT" && node "${gdir}/gate.mjs" check --task "$BOARD_CARD" --pre-complete --db "$snap" --repo "$REPO_ROOT" 2>&1)"; rc=$?
      printf '\n[prefix gate] exit=%s\n%s\n' "$rc" "$out"
      if [ $rc -eq 1 ] && printf '%s' "$out" | grep -q "R5_EVIDENCE_FILE_MISSING"; then ok "reported instance reproduced on the prefix gate (R5)"; else bad "prefix gate did not reproduce the reported R5"; fi
    fi
    out="$(cd "$REPO_ROOT" && node "$GATE" check --task "$BOARD_CARD" --pre-complete --db "$snap" --repo "$REPO_ROOT" 2>&1)"; rc=$?
    printf '\n[fixed gate] exit=%s\n%s\n' "$rc" "$out"
    if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q "A6_EVIDENCE_CITED" && ! printf '%s' "$out" | grep -q "R5_EVIDENCE_FILE_MISSING"; then
      ok "fixed gate: reporting card passes, quoted path downgraded to A6_EVIDENCE_CITED"
    else
      bad "fixed gate: expected exit 0 + A6 and no R5 (got exit=$rc)"
    fi
  else
    bad "no comment on ${BOARD_CARD} quoting t_28f60dc1 — live replay skipped"
  fi
  note "4. control: the card that CLAIMS a missing artifact of its own must still fail R5"
  out="$(cd "$REPO_ROOT" && node "$GATE" check --task "$CONTROL_CARD" --db "$BOARD" --repo "$REPO_ROOT" 2>&1)"; rc=$?
  printf '%s\n' "$out"
  if [ $rc -eq 1 ] && printf '%s' "$out" | grep -q "R5_EVIDENCE_FILE_MISSING"; then ok "claimed-but-missing evidence still blocks (${CONTROL_CARD})"; else bad "R5 no longer fires on claimed missing evidence"; fi
else
  bad "no board at ${BOARD} — replay skipped"
fi

note "5. installed gate copies must equal the repo copy (SHA-256)"
repo_sha="$(sha "$GATE")"
for p in architect backend browser docs frontend product qa; do
  f="${HOME}/.hermes/profiles/${p}/agent-hooks/signoff-gate.mjs"
  if [ -f "$f" ] && [ "$(sha "$f")" = "$repo_sha" ]; then ok "${p}: installed copy matches the repo copy"; else bad "${p}: installed copy missing or drifted ($f)"; fi
done

if [ "$FULL" -eq 1 ]; then
  note "6. re-install in all 7 profiles + live verification (--full)"
  (cd "$REPO_ROOT" && bash scripts/qa/hooks/install-signoff-gate.sh --all --apply) | tail -3
  fix="$(mktemp -d)"; mkdir -p "${fix}/repo/tests/evidence/t_aaaaaaaa"
  sqlite3 "${fix}/board.db" <<'SQL'
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
  echo "synthetic verifier fixture evidence — no real data" > "${fix}/repo/tests/evidence/t_aaaaaaaa/README.md"
  git -C "${fix}/repo" init -q -b main
  git -C "${fix}/repo" config user.email fixture@example.invalid
  git -C "${fix}/repo" config user.name "gate fixture"
  git -C "${fix}/repo" add -A && git -C "${fix}/repo" commit -qm "verifier fixture repo"
  (cd "$REPO_ROOT" && bash scripts/qa/hooks/verify-signoff-gate.sh --all --live \
     --fixture-db "${fix}/board.db" --fixture-noncompliant t_bbbbbbbb \
     --fixture-compliant t_aaaaaaaa --fixture-repo "${fix}/repo") | tail -4
  echo "note: 3 'doctor' FAILs are expected on a host with two hooks per profile — see QA_SIGN_OFF_GATE.md §8.1"
fi

printf '\n%s\n' "──────────────────────────────"
if [ "$fails" -eq 0 ]; then
  printf 'reproduce: ALL EXPECTATIONS MET\n'; exit 0
fi
printf 'reproduce: %s expectation(s) NOT met\n' "$fails"; exit 1
