#!/usr/bin/env bash
# Prove whether .gitleaksignore (master) suppresses the live-token finding,
# i.e. whether the CI secret-scan gate is neutered on the default branch.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
RAW="$WS/raw"
mkdir -p "$RAW"
export PATH="$HOME/.local/bin:$PATH"

echo "############ 1) gitleaks on a FRESH checkout of PUBLIC master, .gitleaksignore IN PLACE (as CI sees it) ############"
cd "$WS" || exit 1
if [ ! -d master-checkout ]; then
  git clone --branch master https://github.com/zeldadil/password-manager.git master-checkout 2>&1 | tail -2
fi
cd master-checkout || exit 1
git log --oneline -1
gitleaks detect --source . --no-banner --redact --report-format json --report-path "$RAW/gitleaks-master-ignored.json" 2>&1 | tail -4
echo "findings WITH .gitleaksignore: $(jq 'length' "$RAW/gitleaks-master-ignored.json" 2>/dev/null)"
echo

echo "############ 2) same checkout, .gitleaksignore DISABLED (renamed) — true gate behaviour ############"
mv .gitleaksignore .gitleaksignore.disabled
gitleaks detect --source . --no-banner --redact --report-format json --report-path "$RAW/gitleaks-master-nogignore.json" 2>&1 | tail -4
echo "findings WITHOUT .gitleaksignore: $(jq 'length' "$RAW/gitleaks-master-nogignore.json" 2>/dev/null)"
jq -r '.[] | "\(.RuleID)\t\(.File)\t\(.Commit[0:7])\tline=\(.StartLine)"' "$RAW/gitleaks-master-nogignore.json" 2>/dev/null
mv .gitleaksignore.disabled .gitleaksignore
echo

echo "############ 3) master ci.yml: which secret-scan steps exist? ############"
grep -n "gitleaks\|trufflehog\|truffleHog" .github/workflows/ci.yml | head -20
echo
echo "############ 4) generic-api-key hit in signoff-gate.selftest.mjs (line 353) — synthetic or real? ############"
sed -n '348,356p' scripts/qa/signoff-gate.selftest.mjs | perl -pe 's/[0-9]{8,12}:[A-Za-z0-9_-]{35}/[REDACTED-TOKEN]/g'
