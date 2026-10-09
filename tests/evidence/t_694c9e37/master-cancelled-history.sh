#!/usr/bin/env bash
# t_694c9e37 — list every attempt of every CI run on `master` (push + workflow_dispatch)
# with its conclusion, so a `cancelled` attempt hidden behind a later successful
# re-run is visible (gh run list only shows the latest attempt).
# Usage: bash tests/evidence/t_694c9e37/master-cancelled-history.sh [limit]
set -euo pipefail
REPO="zeldadil/password-manager"
LIMIT="${1:-40}"
echo "# generated $(date -u +%FT%TZ) — repo $REPO — last $LIMIT CI runs on master, every attempt"
printf 'run_id\tattempt\tsha\tevent\tconclusion\tcreated_at\n'
gh api "repos/$REPO/actions/workflows/ci.yml/runs?branch=master&per_page=$LIMIT" \
  --jq '.workflow_runs[] | [.id, .run_attempt, .head_sha[0:7], .event] | @tsv' |
while IFS=$'\t' read -r id attempts sha event; do
  a=1
  while [ "$a" -le "$attempts" ]; do
    gh api "repos/$REPO/actions/runs/$id/attempts/$a" \
      --jq "[.id, .run_attempt, \"$sha\", .event, (.conclusion // .status), .run_started_at] | @tsv"
    a=$((a + 1))
  done
done
