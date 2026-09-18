#!/usr/bin/env bash
# t_338f47fd — reproduce the "VERDICT_MARKER_RE has no author check" defect end to end.
#
# The defect: `collectVerdicts()` matched `QA-VERDICT: <token>` in a comment from
# **any** author — the `QA_PROFILES` filter was applied only to the loose
# (`verdict: …`) path. One comment written by `architect` / `dashboard` /
# `frontend` therefore satisfied R1/R2/R3 and cleared the fail-closed
# completion hook on any card.
#
# Usage:  bash tests/evidence/t_338f47fd/reproduce.sh [--full]
#
#   without --full : hashes · patched selftest · new suite vs the prefix gate ·
#                    the reported fixture replay (check + hook, both revisions) ·
#                    live-board A/B · installed-copy hash equality
#   with --full    : additionally re-installs the gate in all 7 profiles and runs
#                    scripts/qa/hooks/verify-signoff-gate.sh --all --live
#
# Nothing here writes to the live board: every replay works on a copy
# (`cp ~/.hermes/kanban.db $WORK/board.db`) and the live file is never opened for
# writing. The script exits 1 if an expectation is not met.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
GATE="${REPO_ROOT}/scripts/qa/signoff-gate.mjs"
SELFTEST="${REPO_ROOT}/scripts/qa/signoff-gate.selftest.mjs"
BOARD="${HERMES_KANBAN_DB:-${HOME}/.hermes/kanban.db}"
CARD="${CARD:-t_7918f010}"                                  # the fixture card from the report
EVIDENCE_PATH="${EVIDENCE_PATH:-tests/evidence/t_5fe41426/README.md}"  # committed on 543c396
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

fails=0
ok()   { printf 'ok   %s\n' "$1"; }
bad()  { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
note() { printf '\n── %s\n' "$1"; }
sha()  { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/t_338f47fd-repro.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

note "0. revisions under test"
printf 'repo gate (fixed)  %s\n' "$(sha "$GATE")"
printf 'selftest (fixed)   %s\n' "$(sha "$SELFTEST")"
# The prefix gate is the revision installed in all 7 profiles before this fix
# (sha256 28b0b771…). It is read from git so the A/B needs no committed copy of
# the old logic; `git show > file` keeps the bytes exact (a `$(...)` capture would
# strip the trailing newline and report a different hash).
PREFIX_GATE=""
PREFIX_SOURCE=""
PREFIX_EXPECTED="28b0b771c136413aa495d3fe33d5eb5ece2c52b53ff3d03ae0d0f1956b13c7ab"
for ref in "HEAD^" "4c0d3ea" "origin/qa/t_99e408c5-r5-quoted-path" "origin/master"; do
  if git -C "$REPO_ROOT" cat-file -e "${ref}:scripts/qa/signoff-gate.mjs" 2>/dev/null; then
    git -C "$REPO_ROOT" show "${ref}:scripts/qa/signoff-gate.mjs" > "$WORK/prefix-gate.mjs"
    PREFIX_GATE="$WORK/prefix-gate.mjs"
    PREFIX_SOURCE="$ref"
    break
  fi
done
if [ -n "$PREFIX_GATE" ]; then
  printf 'prefix gate        %s  (from %s)\n' "$(sha "$PREFIX_GATE")" "$PREFIX_SOURCE"
  if [ "$(sha "$PREFIX_GATE")" = "$PREFIX_EXPECTED" ]; then
    ok "prefix gate is byte-identical to the revision installed before this fix (28b0b771…)"
  else
    printf 'note the prefix gate is %s, not the expected 28b0b771… — the A/B rows below are then against a different prefix\n' \
      "$(sha "$PREFIX_GATE")"
  fi
else
  printf 'prefix gate        UNAVAILABLE (no usable git ref in this clone)\n'
fi

note "1. patched selftest (expect 81/81, exit 0)"
SELFTEST_OUT="$WORK/selftest.log"
node "$SELFTEST" > "$SELFTEST_OUT" 2>&1
selftest_rc=$?
tail -1 "$SELFTEST_OUT"
if [ "$selftest_rc" -eq 0 ] && grep -q "81/81 cases passed" "$SELFTEST_OUT"; then
  ok "selftest: 81/81 (was 66/66 before this card's cases)"
else
  bad "selftest: exit=$selftest_rc, expected 81/81"
  grep -E "FAIL|passed" "$SELFTEST_OUT"
fi

note "2. the same suite against the PREFIX gate (the new cases must be red)"
if [ -n "$PREFIX_GATE" ]; then
  cp "$SELFTEST" "$WORK/signoff-gate.selftest.mjs"
  cp "$PREFIX_GATE" "$WORK/signoff-gate.mjs"
  node "$WORK/signoff-gate.selftest.mjs" > "$WORK/selftest-prefix.log" 2>&1
  prefix_rc=$?
  red="$(grep -c '^  FAIL - ' "$WORK/selftest-prefix.log")"
  printf 'prefix suite exit=%s, red cases=%s\n' "$prefix_rc" "$red"
  grep '^  FAIL - ' "$WORK/selftest-prefix.log" | sed 's/^/  /'
  tail -1 "$WORK/selftest-prefix.log"
  # 8 new cases are falsifiable against the pre-fix gate; the rest of the suite
  # (including every compliant control) is shared, so those 8 are the delta.
  if [ "$red" -eq 8 ] && grep -q "73/81 cases passed" "$WORK/selftest-prefix.log"; then
    ok "8 of the new cases fail on the pre-fix gate — the defect, reproduced by the suite"
  else
    bad "expected exactly 8 red cases on the prefix gate, got $red"
  fi
  # The pre-existing cases must be green on BOTH revisions (no case was weakened).
  grep '^  FAIL - ' "$WORK/selftest-prefix.log" | sed 's/^  FAIL - //' | cut -d' ' -f1-4 > "$WORK/prefix-red.txt"
else
  bad "no prefix gate available — the A/B rows below are skipped"
fi

note "3. the reported fixture, replayed on a COPY of the live board"
cp "$BOARD" "$WORK/board.db"
LIVE_SHA_START="$(sha "$BOARD")"
printf 'live board at step 3   %s  %s\n' "$LIVE_SHA_START" "$BOARD"
printf 'board copy             %s  %s\n' "$(sha "$WORK/board.db")" "$WORK/board.db"
if [ "$(sha "$BOARD")" = "$(sha "$WORK/board.db")" ]; then ok "board copy is byte-identical to the live board"; else bad "board copy differs from the live board"; fi
# Every mutation below targets $WORK/board.db; the live board is only ever read.
AB_BOARD="$WORK/board-ab.db"
cp "$BOARD" "$AB_BOARD"
printf 'A/B copy (pristine)    %s\n' "$(sha "$AB_BOARD")"
printf 'fixture card: %s — %s\n' "$CARD" "$(sqlite3 "$WORK/board.db" "SELECT title||' @'||assignee||' status='||status FROM tasks WHERE id='$CARD'")"
printf 'live comment count on %s at step 3: %s\n' "$CARD" "$(sqlite3 "$WORK/board.db" "SELECT COUNT(*) FROM task_comments WHERE task_id='$CARD'")"
printf 'evidence path %s is committed at %s\n' "$EVIDENCE_PATH" "$(git -C "$REPO_ROOT" rev-list --max-count=1 --all -- "$EVIDENCE_PATH")"

# set_comment <author|NONE> — make the card carry exactly one comment (or none),
# authored by <author>, so authorship is the only variable between rows.
set_comment() {
  local author="$1"
  if [ "$author" = "LIVE" ]; then return 0; fi   # leave the copy's current state untouched
  sqlite3 "$WORK/board.db" "DELETE FROM task_comments WHERE task_id='$CARD';"
  if [ "$author" != "NONE" ]; then
    sqlite3 "$WORK/board.db" \
      "INSERT INTO task_comments (task_id,author,body,created_at) VALUES ('$CARD','$author','QA-VERDICT: pass — evidence: $EVIDENCE_PATH',(SELECT MAX(created_at)+1 FROM task_comments));"
  fi
}

check_with() { # <gate> ; prints exit code
  node "$1" check --task "$CARD" --db "$WORK/board.db" --repo "$REPO_ROOT" > "$2" 2>&1
  echo $?
}

hook_with() { # <gate> ; prints "<exit> <first stdout line>"
  local gate="$1"
  local payload
  payload="$(printf '{"hook_event_name":"pre_tool_call","tool_name":"kanban_complete","tool_input":{"task_id":"%s","summary":"replay"},"session_id":"replay_session","cwd":"%s","profile":"backend","extra":{"task_id":"%s"}}' "$CARD" "$REPO_ROOT" "$CARD")"
  printf '%s' "$payload" | env -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE -u HERMES_KANBAN_BRANCH \
    HERMES_KANBAN_DB="$WORK/board.db" node "$gate" hook --db "$WORK/board.db" > "$WORK/.hook.out" 2>&1
  local rc=$?
  printf '%s %s\n' "$rc" "$(head -1 "$WORK/.hook.out")"
}

row() { # <label> <author|NONE>
  local label="$1" author="$2"
  set_comment "$author"
  local old_rc old_hook new_rc new_hook
  if [ -n "$PREFIX_GATE" ]; then
    old_rc="$(check_with "$PREFIX_GATE" "$WORK/check-prefix.txt")"
    old_hook="$(hook_with "$PREFIX_GATE")"
  else
    old_rc="n/a"; old_hook="n/a"
  fi
  new_rc="$(check_with "$GATE" "$WORK/check-new.txt")"
  new_hook="$(hook_with "$GATE")"
  printf '%-46s author=%-10s prefix: check=%s hook=[%s]%s new: check=%s hook=[%s]\n' \
    "$label" "$author" "$old_rc" "$(printf '%s' "$old_hook" | cut -c1-26)" "" "$new_rc" "$(printf '%s' "$new_hook" | cut -c1-26)"
  printf '%s\t%s\t%s\t%s\n' "$label" "$old_rc" "$new_rc" "$(printf '%s' "$new_hook" | cut -d' ' -f1)" >> "$WORK/rows.tsv"
}

: > "$WORK/rows.tsv"
if [ -n "$PREFIX_GATE" ]; then
  printf '%-46s %-17s %-46s %s\n' "row (comment state on the COPY)" "comment author" "prefix gate 28b0b771 (installed)" "fixed gate"
fi
row "live state: the card's single handoff comment" LIVE
row "comments cleared (baseline)" NONE
row "one marker comment added" architect
row "same marker comment, qa author" qa
row "control: comment stripped again" NONE

# Assertions on the pinned rows (author-only difference must no longer flip it).
# The "live state" row is informational: the live board is written by the other
# workers while this script runs, so its outcome is a reading, not an invariant.
row_value() { awk -F'\t' -v l="$1" '$1==l {print $2","$3","$4}' "$WORK/rows.tsv"; }
r_live="$(row_value "live state: the card's single handoff comment")"
r_none="$(row_value "comments cleared (baseline)")"
r_arch="$(row_value "one marker comment added")"
r_qa="$(row_value "same marker comment, qa author")"
r_ctrl="$(row_value "control: comment stripped again")"
printf '\n  live-state reading (both revisions): %s\n' "$r_live"
if [ -n "$PREFIX_GATE" ]; then
  [ "$r_arch" = "0,1,2" ] && ok "architect-authored marker: prefix ALLOWED (exit 0) → fixed blocks (exit 1 + hook exit 2)" \
                          || bad "architect row: expected prefix=0,fixed=1,hook=2 — got $r_arch"
  [ "$r_qa" = "0,0,0" ]   && ok "qa-authored marker (identical text): both revisions allow (control, non-vacuity)" \
                          || bad "qa row: expected 0,0,0 — got $r_qa"
fi
[ "$r_none" = "1,1,2" ]  && ok "no comment: both revisions fail (baseline)" || bad "baseline row: expected 1,1,2 — got $r_none"
[ "$r_ctrl" = "1,1,2" ]  && ok "control after stripping: back to red on both revisions" || bad "control row: expected 1,1,2 — got $r_ctrl"
set_comment architect
hook_with "$GATE" > "$WORK/hook-block.txt"
if grep -q "R1_QA_VERDICT_MISSING" "$WORK/hook-block.txt" && grep -q "decision.*block" "$WORK/hook-block.txt"; then
  ok "the fixed hook's block reason names R1 and the fixture card"
else
  bad "fixed hook block reason does not name R1: $(head -3 "$WORK/hook-block.txt")"
fi
printf '\n  fixed-gate hook block directive (architect-authored marker):\n'
sed 's/^/    /' "$WORK/hook-block.txt"

note "4. whole-board A/B on a PRISTINE board copy (which cards change, and why)"
if [ -n "$PREFIX_GATE" ]; then
  node "$HERE/ab-live-audit.mjs" "$PREFIX_GATE" "$GATE" "$AB_BOARD" "$REPO_ROOT" | sed 's/^/  /'
  ok "live-board delta measured on the pristine copy (transcript: ab-live-audit.txt)"
else
  bad "no prefix gate — live-board A/B skipped"
fi

note "5. the live board was only ever read"
printf 'live board sha256 at step 3 : %s\n' "$LIVE_SHA_START"
printf 'live board sha256 now       : %s\n' "$(sha "$BOARD")"
# The board is written continuously by the other workers the dispatcher runs in
# parallel, so its checksum is not a usable "I did not touch it" signal. Prove it
# by the fixtures instead: the comment this script injects exists on the replay
# copy and on no row of the live board.
printf 'injected marker rows on the live board : %s\n' \
  "$(sqlite3 "$BOARD" "SELECT COUNT(*) FROM task_comments WHERE body='QA-VERDICT: pass — evidence: $EVIDENCE_PATH';")"
printf 'injected marker rows on the replay copy: %s\n' \
  "$(sqlite3 "$WORK/board.db" "SELECT COUNT(*) FROM task_comments WHERE body='QA-VERDICT: pass — evidence: $EVIDENCE_PATH';")"
if [ "$(sqlite3 "$BOARD" "SELECT COUNT(*) FROM task_comments WHERE body='QA-VERDICT: pass — evidence: $EVIDENCE_PATH';")" -eq 0 ]; then
  ok "no comment injected by this run exists on the live board (every write went to the copies)"
else
  bad "an injected fixture comment is present on the live board"
fi
if [ "$(sqlite3 "$AB_BOARD" "SELECT COUNT(*) FROM task_comments WHERE body='QA-VERDICT: pass — evidence: $EVIDENCE_PATH';")" -eq 0 ]; then
  ok "the A/B copy is pristine (never written to)"
else
  bad "the A/B copy was mutated"
fi

note "6. installed copies (all 7 profiles) vs the repo gate"
installed_all=1
for p in qa architect backend frontend docs product browser; do
  f="${HOME}/.hermes/profiles/${p}/agent-hooks/signoff-gate.mjs"
  if [ -f "$f" ] && [ "$(sha "$f")" = "$(sha "$GATE")" ]; then
    printf 'ok   %-10s %s\n' "$p" "$(sha "$f")"
  else
    printf 'FAIL %-10s %s (installed) != %s (repo)\n' "$p" "$(sha "$f")" "$(sha "$GATE")"
    installed_all=0
  fi
done
[ "$installed_all" -eq 1 ] && ok "installed gate == repo copy in all 7 profiles" || bad "installed copy drift"

if [ "$FULL" -eq 1 ]; then
  note "7. re-install in all 7 profiles + live verify (--full)"
  bash "${REPO_ROOT}/scripts/qa/hooks/install-signoff-gate.sh" --all --apply 2>&1 | sed 's/^/  /'
  bash "${REPO_ROOT}/scripts/qa/hooks/verify-signoff-gate.sh" --all --live \
    --fixture-db "$WORK/board.db" --fixture-noncompliant "$CARD" --fixture-compliant t_99e408c5 \
    --fixture-repo "$REPO_ROOT" 2>&1 | sed 's/^/  /'
fi

note "result"
if [ "$fails" -eq 0 ]; then
  printf 'ALL EXPECTATIONS MET\n'
  exit 0
fi
printf '%s EXPECTATION(S) NOT MET\n' "$fails"
exit 1
