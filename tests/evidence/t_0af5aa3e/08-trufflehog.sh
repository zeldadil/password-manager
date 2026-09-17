#!/usr/bin/env bash
# truffleHog over a non-bare checkout of the public repo (all refs) — mirrors the
# CI secret-scan job's truffleHog step. Raw secret material is stripped from output.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
RAW="$WS/raw"
mkdir -p "$RAW"
export PATH="$HOME/.local/bin:$PATH"
CHECKOUT="$WS/master-checkout"
cd "$CHECKOUT" || exit 1
echo "checkout HEAD: $(git log --oneline -1)"
echo "refs present: $(git for-each-ref --format='%(refname)' refs/remotes/origin | wc -l)"
echo "--- trufflehog results=verified,unknown ---"
trufflehog git "file://$CHECKOUT" --results=verified,unknown --json --no-update \
  > "$RAW/trufflehog-all.jsonl" 2>"$RAW/trufflehog-all.err"
echo "trufflehog exit=$?"
echo "findings (verified+unknown): $(wc -l < "$RAW/trufflehog-all.jsonl")"
echo "--- metadata (no raw values) ---"
jq -c '{DetectorName, Verified, Commit: (.SourceMetadata.Data.Git.commit // "?"), File: (.SourceMetadata.Data.Git.file // "?"), Line: (.SourceMetadata.Data.Git.line // 0)}' \
  "$RAW/trufflehog-all.jsonl" 2>/dev/null
echo "--- verified-only count ---"
jq -s '[.[] | select(.Verified==true)] | length' "$RAW/trufflehog-all.jsonl" 2>/dev/null
echo "--- stderr tail (if any) ---"
tail -3 "$RAW/trufflehog-all.err"
