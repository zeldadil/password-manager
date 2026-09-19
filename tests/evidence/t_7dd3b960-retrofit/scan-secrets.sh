#!/usr/bin/env bash
# Secret-scan the evidence set before it is pushed to a PUBLIC repo.
set -uo pipefail
DEST=/home/sap/.hermes/kanban/workspaces/t_4242bee8/tests/evidence/t_7dd3b960-retrofit
OUT=/home/sap/qa-retrofit-work
echo "### gitleaks detect (dir mode) over $DEST"
gitleaks detect --no-git --source "$DEST" --redact --verbose > "$OUT/gitleaks-retrofit.txt" 2>&1
echo "gitleaks exit=$? (0 = no leaks)"
tail -6 "$OUT/gitleaks-retrofit.txt"
echo
echo "### trufflehog filesystem scan"
trufflehog filesystem "$DEST" --no-update --results=verified,unknown > "$OUT/trufflehog-retrofit.txt" 2>&1
echo "trufflehog exit=$?"
tail -6 "$OUT/trufflehog-retrofit.txt"
echo
echo "### files scanned: $(find "$DEST" -type f | wc -l)"
