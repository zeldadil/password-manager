#!/usr/bin/env bash
# QA round-2 (execution lens) reproducibility transcript for t_b51a1ff3.
# Everything below is run against a FRESH CLONE of the pushed revision 9f5daab.
# Synthetic fixtures live in /tmp and are masked before publication.
set -u
REPO=/tmp/qa-verify-b51a1ff3-C6E4/repo
F=/tmp/qa-b51a1ff3-fixtures
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "QA t_b51a1ff3 round-2 execution transcript — $DATE"
echo "reviewer: qa (run 477)  ·  reviewed revision: 9f5daab (origin/fix/telegram-token-rotation-t_28951254)"
echo

echo "### 1. reviewed revision is published and the guard is tracked (round-1 D1)"
cd "$REPO"
git log --oneline -1
git ls-files scripts/qa/ | sed 's/^/  tracked: /'
echo

echo "### 2. selftest (fresh clone)"
node scripts/qa/secret-guard.selftest.mjs 2>&1 | tail -4
echo

echo "### 3. installed gate vs reviewed repo copy — sha256 per profile"
sha256sum /home/sap/.hermes/profiles/*/agent-hooks/secret-guard.mjs "$REPO/scripts/qa/secret-guard.mjs" 2>&1
echo "  (repo copy = reviewed 9f5daab; 2e60bb23 = D2-fixed, 5cfffb0e = pre-D2 stale)"
echo

echo "### 4. card's own verifier, all profiles, live"
bash scripts/qa/hooks/verify-secret-guard.sh --all --live \
  --fixture-db "$F/board.db" --fixture-bad t_b0000001 --fixture-good t_b0000000 2>&1 | tail -6
echo

echo "### 5. true runtime wire shape (tool_input, as agent/shell_hooks.py::_payload_fields emits)"
echo "-- CASE A: installed qa hook (stale) + token in kanban_complete.result"
"/home/sap/.hermes/profiles/qa/agent-hooks/secret-guard.sh" < "$F/true-wire-complete-result.json"
echo "   exit=$?   (0 = ALLOWED -> D2 fix not deployed on this profile)"
echo "-- CASE B: installed architect hook (fresh) + same payload"
"/home/sap/.hermes/profiles/architect/agent-hooks/secret-guard.sh" < "$F/true-wire-complete-result.json" >/dev/null 2>&1
echo "   exit=$?   (2 = BLOCKED)"
echo "-- CASE C: repo copy (reviewed) + same payload"
node scripts/qa/secret-guard.mjs hook < "$F/true-wire-complete-result.json" >/dev/null 2>&1
echo "   exit=$?   (2 = BLOCKED)"
echo "-- CASE D (control): installed qa hook + token in a COMMENT BODY"
"/home/sap/.hermes/profiles/qa/agent-hooks/secret-guard.sh" < "$F/true-wire-comment-block.json" >/dev/null 2>&1
echo "   exit=$?   (2 = BLOCKED -> plumbing works; CASE A is stale code, not plumbing)"
echo

echo "### 6. verifier doctor-check pattern vs real doctor wording (D3 residue)"
tail -1 /tmp/secret-guard-doctor-backend.txt | sed 's/^/  doctor backend says: /'
grep -qi "issue(s)? found" /tmp/secret-guard-doctor-backend.txt
echo "  repo pattern 'issue(s)? found' matched: $? (1 = NO match -> verifier prints 'doctor clean' on a broken profile)"
echo

echo "### 7. verifier consent-check scope (D3 residue)"
HERMES_HOME=/home/sap/.hermes/profiles/backend hermes hooks list 2>&1 | grep -E "signoff-gate|secret-guard" | sed 's/^/  /'
echo "  (signoff-gate line carries 'allowed' -> grep passes, although secret-guard itself is not allowlisted)"
echo

echo "### 8. AC3 scanners"
gitleaks detect --source . --no-banner --redact 2>&1 | tail -3
node "$F/read-gitleaks2.cjs" "$F/gitleaks.json"
trufflehog filesystem . --results=verified,unknown 2>&1 | grep -E "finished scanning" | tail -1
echo

echo "### 9. AC5 — no allowlist/exclusion silences the guard"
ls /home/sap/.hermes/secret-guard.disabled 2>&1 | sed 's/^/  /'
grep -cE "allowlist|exclude" scripts/qa/secret-guard.mjs | sed 's/^/  guard-source allowlist hits: /'
echo "  .gitleaksignore entries:"; grep -cE "^[0-9a-f]{7,}" .gitleaksignore
