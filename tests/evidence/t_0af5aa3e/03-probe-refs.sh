#!/usr/bin/env bash
# Map each gitleaks finding commit to the public branches that reach it, and
# enumerate every public branch whose head-project-brief still carries the token.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
cd "$WS/repo.git" || exit 1

echo "############ finding-commit -> public branches that reach it ############"
for c in a503e4d3601762619fa751138a4b360ea65621f6 543c396d8bf4289492b80066a93e8c9f51de8c2a 258ca92b8234d6dc7d41f55b39fdeb00a00c335c; do
  echo "--- commit ${c:0:7} reachable from:"
  git for-each-ref --contains "$c" --format='    %(refname)' refs/heads
done

echo
echo "############ per-ref probe: token pattern present in PROJECT_BRIEF.md at ref tip ############"
printf '%-40s %-10s %s\n' "PUBLIC_REF" "TIP" "TOKEN_IN_TIP"
for ref in $(git for-each-ref --format='%(refname)' refs/heads); do
  commit=$(git rev-parse --short "$ref")
  hits=$(git grep -c -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$ref" -- PROJECT_BRIEF.md 2>/dev/null | wc -l)
  if [ "$hits" -gt 0 ]; then found=YES; else found=no; fi
  printf '%-40s %-10s %s\n' "${ref#refs/heads/}" "$commit" "$found"
done

echo
echo "############ per-ref: does ref HISTORY contain the token (pickaxe on bot id) ############"
for ref in $(git for-each-ref --format='%(refname)' refs/heads); do
  n=$(git log --oneline -S'8615677595' "$ref" -- PROJECT_BRIEF.md 2>/dev/null | wc -l)
  printf '%-40s history_commits=%s\n' "${ref#refs/heads/}" "$n"
done
