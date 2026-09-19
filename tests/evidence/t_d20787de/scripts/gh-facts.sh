#!/bin/bash
# t_d20787de — CI/board-variable facts for the retro-verification (read-only GitHub API reads).
set -u
R=zeldadil/password-manager
echo "=== gh auth ==="
gh auth status 2>&1 | head -4
echo
echo "=== t_e348e0b7: negative-control red-case runs ==="
for id in 35259047666 35261467319 35262427071; do
  echo "--- run $id"
  gh run view "$id" --repo "$R" --json databaseId,status,conclusion,headBranch,event,displayTitle,createdAt \
    --jq '"  id=\(.databaseId) status=\(.status) conclusion=\(.conclusion) branch=\(.headBranch) event=\(.event) title=\(.displayTitle[0:70])"' 2>&1
  gh run view "$id" --repo "$R" --json jobs \
    --jq '.jobs[] | select(.name|test("secret-scan")) | "  job \(.name): \(.conclusion)"' 2>&1
done
echo
echo "=== t_28951254: branch CI run ==="
gh run view 35265374451 --repo "$R" --json databaseId,status,conclusion,headBranch,event,displayTitle \
  --jq '"  id=\(.databaseId) status=\(.status) conclusion=\(.conclusion) branch=\(.headBranch) event=\(.event) title=\(.displayTitle[0:70])"' 2>&1
gh run view 35265374451 --repo "$R" --json jobs \
  --jq '.jobs[] | select(.name|test("secret-scan")) | "  job \(.name): \(.conclusion)"' 2>&1
echo
echo "=== t_527d4720: dispatch run that audited the real board ==="
gh run view 35253319631 --repo "$R" --json databaseId,status,conclusion,headBranch,event,displayTitle,createdAt \
  --jq '"  id=\(.databaseId) status=\(.status) conclusion=\(.conclusion) branch=\(.headBranch) event=\(.event) created=\(.createdAt) title=\(.displayTitle[0:80])"' 2>&1
gh run view 35253319631 --repo "$R" --json jobs \
  --jq '.jobs[] | "  job \(.name) runner=\(.runnerName) conclusion=\(.conclusion)"' 2>&1
echo
echo "=== t_527d4720 / t_ea0783c5: repo variable QA_SIGNOFF_AUDIT_RUNNER ==="
gh api "repos/$R/actions/variables" --jq '.variables[] | "  \(.name) = \(.value)  (updated \(.updated_at))"' 2>&1
echo
echo "=== t_c3cb6842: PR #24 ==="
gh pr view 24 --repo "$R" --json number,title,state,mergeCommit,mergedAt,headRefName,statusCheckRollup \
  --jq '{number,title,state,head:.headRefName,merge:(.mergeCommit.oid // "-"),mergedAt,checks:[.statusCheckRollup[]|select(.__typename=="CheckRun")|(.name+":"+.conclusion)]}' 2>&1
echo
echo "=== master: does it carry the gate fix + the truffleHog wiring? ==="
gh api "repos/$R/contents/scripts/qa/signoff-gate.mjs" --jq '"  scripts/qa/signoff-gate.mjs on master: blob \(.sha)"' 2>&1
gh api "repos/$R/contents/.github/workflows/ci.yml" --jq '"  .github/workflows/ci.yml on master: blob \(.sha)"' 2>&1
