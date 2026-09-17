#!/usr/bin/env bash
# Which OPEN pull requests expose the live token in their public diff?
# A PR exposes it iff its head branch tip (or any of its commits) carries the token.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
cd "$WS/repo.git" || exit 1
PAT='[0-9]{8,12}:[A-Za-z0-9_-]{35}'

printf '%-6s %-42s %s\n' "PR" "HEAD_REF" "TOKEN_IN_PR_DIFF"
gh pr list --state open --limit 100 --json number,headRefName \
  --jq '.[] | "\(.number)\t\(.headRefName)"' > "$WS/raw/open-prs.tsv" 2>/dev/null

while IFS=$'\t' read -r num ref; do
  if ! git rev-parse --verify -q "refs/heads/$ref" >/dev/null; then
    printf '%-6s %-42s %s\n' "$num" "$ref" "REF-NOT-ON-REMOTE"
    continue
  fi
  tip=$(git grep -c -E "$PAT" "refs/heads/$ref" -- PROJECT_BRIEF.md 2>/dev/null | wc -l)
  hist=$(git log --oneline -S'8615677595' "refs/heads/$ref" -- PROJECT_BRIEF.md 2>/dev/null | wc -l)
  if [ "$tip" -gt 0 ]; then st="YES (in head tip)"; elif [ "$hist" -gt 0 ]; then st="YES (in commits only)"; else st="no"; fi
  printf '%-6s %-42s %s\n' "$num" "$ref" "$st"
done < "$WS/raw/open-prs.tsv"
