#!/usr/bin/env bash
# QA full-history secret scan against the FRESH PUBLIC mirror clone.
# Raw reports (contain secret values) stay in $WS/raw/; only redacted metadata is printed.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
RAW="$WS/raw"
mkdir -p "$RAW"
cd "$WS/repo.git" || exit 1
export PATH="$HOME/.local/bin:$PATH"

echo "############ gitleaks: full history of ALL public refs ############"
gitleaks detect --source . --no-banner --redact \
  --report-format json --report-path "$RAW/gitleaks-public.json" 2>&1 | tail -8
echo "gitleaks exit=$?"
echo
echo "--- gitleaks finding count ---"
jq 'length' "$RAW/gitleaks-public.json" 2>/dev/null
echo
echo "--- gitleaks findings: RuleID / File / Commit / presence-of-token (REDACTED) ---"
jq -r '.[] | "\(.RuleID)\t\(.File)\t\(.Commit)\tline=\(.StartLine)"' "$RAW/gitleaks-public.json" 2>/dev/null | sort | uniq -c | sort -rn
echo
echo "--- distinct commits carrying a telegram-bot-api-token finding ---"
jq -r '[.[] | select(.RuleID=="telegram-bot-api-token") | .Commit] | unique | length' "$RAW/gitleaks-public.json" 2>/dev/null
jq -r '.[] | select(.RuleID=="telegram-bot-api-token") | .Commit' "$RAW/gitleaks-public.json" 2>/dev/null | sort -u
echo
echo "--- distinct branches whose tip history contains a finding (via commit -> branch mapping below) ---"
