#!/usr/bin/env bash
# Compare token VALUES by SHA-256 only (never printing the secret):
#  - copy in PROJECT_BRIEF.md @ a503e4d (original leak)
#  - copy in the architect evidence file @ be10983 (post-remediation re-leak)
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
cd "$WS/repo.git" || exit 1
PAT='[0-9]{8,12}:[A-Za-z0-9_-]{35}'

A=$(git show a503e4d3601762619fa751138a4b360ea65621f6:PROJECT_BRIEF.md | grep -oE "$PAT" | head -1)
B=$(git show be10983:tests/evidence/t_0af5aa3e/gitrepo-post-purge-state.md | grep -oE "$PAT" | head -1)
C=$(git show 7697462:PROJECT_BRIEF.md | grep -oE "$PAT" | head -1)
D=$(git show 543c396d8bf4289492b80066a93e8c9f51de8c2a:PROJECT_BRIEF.md | grep -oE "$PAT" | head -1)

printf 'A original leak  (a503e4d PROJECT_BRIEF.md)     sha256=%s len=%s\n' "$(printf '%s' "$A" | sha256sum | cut -c1-16)" "${#A}"
printf 'B evidence file  (be10983 evidence .md)         sha256=%s len=%s\n' "$(printf '%s' "$B" | sha256sum | cut -c1-16)" "${#B}"
printf 'C qa branch tip  (7697462 PROJECT_BRIEF.md)     sha256=%s len=%s\n' "$(printf '%s' "$C" | sha256sum | cut -c1-16)" "${#C}"
printf 'D master history (543c396 PROJECT_BRIEF.md)     sha256=%s len=%s\n' "$(printf '%s' "$D" | sha256sum | cut -c1-16)" "${#D}"
echo
if [ "$A" = "$B" ] && [ "$B" = "$C" ] && [ "$C" = "$D" ]; then
  echo "SAME CREDENTIAL in all four locations (single leaked token, no rotation)."
else
  echo "Values differ — inspect individually."
fi
echo
echo "evidence-file occurrences on pushed tip be10983: $(git show be10983:tests/evidence/t_0af5aa3e/gitrepo-post-purge-state.md | grep -cE "$PAT")"
