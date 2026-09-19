#!/bin/bash
# t_d20787de — local reproduction of the AC1/AC2 sensor for t_e348e0b7 and the AC5 sensor for t_28951254.
# SECRET DISCIPLINE: any token-shaped string in the output is replaced with <TOKEN-REDACTED> before it is
# written to disk; the transcript is committed to a PUBLIC repo.
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
CLONE=/home/sap/password-manager-check
RED='s/[0-9]{8,12}:[A-Za-z0-9_-]{35}/<TOKEN-REDACTED>/g'
OUT="$SCR/scan-reproduction.txt"

{
echo "=== environment ==="
echo "trufflehog: $(trufflehog --version 2>&1 | head -1)"
echo "gitleaks:   $(gitleaks version 2>&1 | head -1)"
echo "clone:      $CLONE ($(git -C "$CLONE" rev-list --all | wc -l) commits reachable)"
echo "date:       $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "=== M1a. the exact command master CI runs, on the real clone (trufflehog git file://. --results=verified,unknown --fail) ==="
cd "$CLONE" || exit 1
set +e
trufflehog git "file://$CLONE" --no-update --results=verified,unknown --fail --json > "$SCR/.th-raw.json" 2>"$SCR/.th-raw.err"
RC=$?
set -e
echo "exit code: $RC   (183 = findings found; 0 = clean)"
echo "verified findings:   $(grep -c '"Verified":true' "$SCR/.th-raw.json" 2>/dev/null || echo 0)"
echo "unverified findings: $(grep -c '"Verified":false' "$SCR/.th-raw.json" 2>/dev/null || echo 0)"
echo "distinct files with a finding:"
grep -o '"file":"[^"]*"' "$SCR/.th-raw.json" 2>/dev/null | sort -u | head -20
echo "--- stderr (redacted) ---"
sed -E "$RED" "$SCR/.th-raw.err" | tail -5
echo

echo "=== M1b. gitleaks detect over the same clone (all-refs history equivalent), redacted ==="
cd "$CLONE" || exit 1
set +e
gitleaks detect --source . --no-banner --redact --report-format json --report-path "$SCR/.gl-raw.json" > "$SCR/.gl-raw.log" 2>&1
GRC=$?
set -e
echo "exit code: $GRC   (1 = leaks found)"
echo "findings: $(grep -o '"RuleID"' "$SCR/.gl-raw.json" 2>/dev/null | wc -l)"
grep -o '"RuleID":"[^"]*"' "$SCR/.gl-raw.json" 2>/dev/null | sort | uniq -c
grep -o '"File":"[^"]*"' "$SCR/.gl-raw.json" 2>/dev/null | sort -u | head -20
echo

echo "=== M2. t_28951254 branch: gitleaks over the branch's own history (AC5 sensor) ==="
WT="$SCR/wt-t28951254"
if [ -d "$WT" ]; then echo "(reusing $WT)"; else git -C "$CLONE" worktree add "$WT" origin/fix/telegram-token-rotation-t_28951254 >/dev/null 2>&1; fi
if [ -d "$WT" ]; then
  cd "$WT" || exit 1
  echo "branch tip: $(git rev-parse --short HEAD)  $(git rev-parse --abbrev-ref HEAD)"
  set +e
  gitleaks detect --source . --no-banner --redact --report-format json --report-path "$SCR/.gl-branch.json" > "$SCR/.gl-branch.log" 2>&1
  BRC=$?
  set -e
  echo "gitleaks exit code (branch history): $BRC"
  echo "findings: $(grep -o '"RuleID"' "$SCR/.gl-branch.json" 2>/dev/null | wc -l)"
  grep -o '"RuleID":"[^"]*"' "$SCR/.gl-branch.json" 2>/dev/null | sort | uniq -c
  echo "--- token-shaped strings on the branch tip tree (count) ---"
  git grep -c -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' HEAD -- . | wc -l
  echo "--- evidence README present? ---"
  ls -la tests/evidence/t_28951254/ 2>/dev/null
  echo "--- evidence README, redacted (first 40 lines) ---"
  sed -E "$RED" tests/evidence/t_28951254/README.md 2>/dev/null | head -40
else
  echo "worktree add failed"
fi
echo
echo "=== M2b. .gitleaksignore content on the branch (documented exclusion?) ---"
sed -n '1,20p' "$WT/.gitleaksignore" 2>/dev/null || echo "(no .gitleaksignore on the branch)"
} 2>&1 | tee "$OUT"
echo "--- written: $OUT ($(wc -l < "$OUT") lines) ---"
echo "--- leak self-check on the transcript ---"
grep -c -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$OUT" || true
