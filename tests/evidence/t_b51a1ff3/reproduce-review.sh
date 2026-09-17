#!/bin/bash
# QA review reproduction for t_b51a1ff3 — leak-free (no secret value is ever printed).
# Every check writes raw output to the transcript file passed as $1.
OUT="${1:-/tmp/qa-review-t_b51a1ff3/transcript-review.txt}"
REPO=/home/sap/password-manager
cd "$REPO" || exit 1

run() { echo; echo "############ $* ############"; "$@" 2>&1; echo "[exit=$?]"; }

{
echo "QA review transcript — t_b51a1ff3 (security guard vs secrets in Kanban)"
echo "host: $(hostname) · date: $(date -Is) · repo: $REPO"
echo "branch: $(git rev-parse --abbrev-ref HEAD) · HEAD: $(git rev-parse --short HEAD)"

echo; echo "############ D1: guard sources tracked in git? ############"
echo "-- git status --short (repo root)"; git status --short
echo "-- git ls-files scripts/qa/  (empty = untracked)"; git ls-files scripts/qa/
echo "-- does any commit anywhere contain the guard? "; git grep -l "secret-guard" $(git rev-list --all) 2>/dev/null | sort -u
echo "-- files in the implementation commit 48b89a3"; git show --stat --format="%H %s" 48b89a3 | head -12
echo "-- is 48b89a3 pushed?"; echo "origin/fix/telegram-token-rotation-t_28951254 = $(git rev-parse --short origin/fix/telegram-token-rotation-t_28951254)"
echo "-- branches containing 48b89a3 (remote):"; git branch -r --contains 48b89a3
echo "-- git check-ignore scripts/qa/secret-guard.mjs (exit 1 = not ignored):"; git check-ignore -v scripts/qa/secret-guard.mjs; echo "[check-ignore exit=$?]"

echo; echo "############ D2: kanban_complete field coverage ############"
echo "-- token in summary (expect block/exit 2):"
hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file /tmp/qa-complete-summary.json 2>&1 | grep -E "secret-guard|exit=" | head -4
echo "-- token in result (expect block; observed ALLOW):"
hermes hooks test pre_tool_call --for-tool kanban_complete --payload-file /tmp/qa-complete-result.json 2>&1 | grep -A2 "secret-guard.sh" | head -4

echo; echo "############ AC1: hermes hooks test — qa profile (real dispatcher path) ############"
echo "-- BLOCK case (kanban_comment + synthetic token fixture):"
hermes hooks test pre_tool_call --for-tool kanban_comment --payload-file /tmp/qa-block-payload.json 2>&1 | head -12
echo "-- ALLOW case (clean comment):"
hermes hooks test pre_tool_call --for-tool kanban_comment --payload-file /tmp/qa-allow-payload.json 2>&1 | head -10
echo "-- BLOCK case, architect profile:"
HERMES_HOME=/home/sap/.hermes/profiles/architect hermes hooks test pre_tool_call --for-tool kanban_comment --payload-file /tmp/qa-block-payload.json 2>&1 | head -12

echo; echo "############ AC1: selftest control matrix (reproduced) ############"
node scripts/qa/secret-guard.selftest.mjs 2>&1 | tail -25

echo; echo "############ AC1: installed copy vs repo copy (sha256) ############"
sha256sum scripts/qa/secret-guard.mjs scripts/qa/hooks/secret-guard.sh
for p in architect backend browser docs frontend product qa; do
  printf "%-9s %s\n" "$p" "$(sha256sum /home/sap/.hermes/profiles/$p/agent-hooks/secret-guard.mjs | cut -c1-16)"
done

echo; echo "############ AC2: process rule + gate-doc cross reference ############"
echo "-- SECURITY.md new section present:"; grep -n "Secrets in Kanban" SECURITY.md
echo "-- SECURITY.md mentions evaluation order / sign-off gate interaction (expect 0 hits):"
grep -c -i "evaluation order\|sign-off gate" SECURITY.md
echo "-- QA_SIGN_OFF_GATE.md in this branch tree:"; git ls-files | grep -c QA_SIGN_OFF_GATE.md
echo "-- QA_SIGN_OFF_GATE.md on origin/master:"; git ls-tree origin/master --name-only | grep -c QA_SIGN_OFF_GATE.md

echo; echo "############ AC3: guard source free of credentials ############"
echo "-- gitleaks detect --source . --no-banner --redact:"; gitleaks detect --source . --no-banner --redact 2>&1 | tail -3
echo "-- findings by file/rule (fingerprints, values redacted):"
python3 /tmp/qa-gl-root.py
echo "-- trufflehog filesystem scripts/qa --results=verified,unknown:"; trufflehog filesystem scripts/qa --results=verified,unknown --no-update 2>&1 | grep "finished scanning" | tail -1

echo; echo "############ AC1/AC4: hooks doctor, all 7 profiles ############"
for p in architect backend browser docs frontend product qa; do
  echo "----- $p -----"
  HERMES_HOME=/home/sap/.hermes/profiles/$p hermes hooks doctor 2>&1 | grep -A6 "secret-guard.sh" | grep -E "secret-guard|✓|⚠|✗" | head -6
done

echo; echo "############ D4: the card's own verifier output ############"
bash scripts/qa/hooks/verify-secret-guard.sh --all 2>&1 | grep -E "^──|FAIL|verification:" | head -20
echo "-- hooks list consent token actually printed by hermes (vs verifier grep string '✓ allowlisted'):"
HERMES_HOME=/home/sap/.hermes/profiles/architect hermes hooks list 2>&1 | grep -E "allowed|allowlisted"
echo "-- verifier grep count for '✓ allowlisted' (0 = false FAIL):"
HERMES_HOME=/home/sap/.hermes/profiles/architect hermes hooks list 2>&1 | grep -c "✓ allowlisted"
echo "-- hermes hooks doctor exit code while printing issues (exit 0 = false 'clean' in verifier):"
HERMES_HOME=/home/sap/.hermes/profiles/backend hermes hooks doctor >/tmp/qa-doc-be.txt 2>&1; echo "doctor exit=$?"; grep "issue(s) found" /tmp/qa-doc-be.txt

echo; echo "############ D4: committed live-fire fixture is non-matching (not reproducible) ############"
printf '%s' 'bot token 8615677595:AAA...AAA is live' | node scripts/qa/secret-guard.mjs check; echo "[exit=$? — 0 means ALLOW]"
printf '%s' 'bot token 9999999999:FAKEFIXTURE0000000000000000000000000 is live' | node scripts/qa/secret-guard.mjs check; echo "[exit=$? — 1 means BLOCK]"

echo; echo "############ AC5: no allowlist/exclusion silences the guard ############"
echo "-- internal allowlist/exclusion inside the guard:"; grep -n -i "allowlist\|whitelist\|exempt" scripts/qa/secret-guard.mjs | grep -v "stdio" ; echo "[grep exit=$? (1 = none)]"
echo "-- .gitleaksignore:"; cat .gitleaksignore | grep -v "^#"
echo "-- kill switch present?"; ls /home/sap/.hermes/secret-guard.disabled 2>&1; ls /home/sap/.hermes/profiles/*/secret-guard.disabled 2>&1

echo; echo "############ leak-free proof: guard catches the REAL leaked comment ############"
echo "-- (value piped straight into check mode; never printed) --"
sqlite3 ~/.hermes/kanban.db "SELECT body FROM task_comments WHERE task_id='t_0af5aa3e'" | node scripts/qa/secret-guard.mjs check 2>/tmp/qa-rc-err.txt; echo "[check exit=$?]"
echo "-- rule ids reported:"; cat /tmp/qa-rc-err.txt
echo "-- board audit (whole board, rule ids only):"; node scripts/qa/secret-guard.mjs audit 2>&1 | head -4; echo "[audit pipeline status above; true exit code:]"
node scripts/qa/secret-guard.mjs audit >/dev/null 2>&1; echo "[audit exit=$? — 1 means secret-shaped text found]"

echo; echo "############ deliverable 3: rotation question posted on t_0af5aa3e ############"
sqlite3 -header -column ~/.hermes/kanban.db "SELECT id, author, datetime(created_at,'unixepoch') AS created, length(body) AS len FROM task_comments WHERE task_id='t_0af5aa3e' ORDER BY id;"

echo; echo "############ e2e: real kanban_comment from this worker session WITH a synthetic fixture ############"
echo "Observed result of a genuine kanban_comment(t_b51a1ff3) tool call carrying fixture"
echo "  '9999999999:FAKEFIXTURE...' (this review run 474, 2026-09-17 ~21:21Z):"
echo '  error: "secret-guard: blocked — the call text matches secret-shaped patterns'
echo '          (rule ids: R_SECRET_TELEGRAM_BOT_TOKEN). No secret value is quoted in this'
echo '          reason — only rule ids. ..."'
echo "Proof the guard blocked it rather than the board swallowing it — comments on this card:"
sqlite3 ~/.hermes/kanban.db "SELECT count(*) AS comments_on_t_b51a1ff3 FROM task_comments WHERE task_id='t_b51a1ff3';"
} 2>&1 | tee "$OUT"
echo
echo "transcript written: $OUT"
