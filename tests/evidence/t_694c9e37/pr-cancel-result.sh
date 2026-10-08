#!/usr/bin/env bash
# t_694c9e37 AC2 (PR side) — record the outcome of pr-cancel-test.sh: every CI run on the
# PR head branch, with its head SHA and conclusion. Expected: the runs of the superseded
# heads end `cancelled`, the run of the last head ends `success`.
# Usage: bash tests/evidence/t_694c9e37/pr-cancel-result.sh <branch>
set -euo pipefail
BR="$1"
echo "# generated $(date -u +%FT%TZ) — CI runs on branch $BR (oldest last)"
printf 'run_id\tsha\tevent\tconclusion\tcreated_at\tupdated_at\n'
gh run list --branch "$BR" --workflow CI -L 50 \
  --json databaseId,headSha,event,conclusion,status,createdAt,updatedAt \
  --jq '.[] | [.databaseId, .headSha[0:7], .event, (if .conclusion == "" then .status else .conclusion end), .createdAt, .updatedAt] | @tsv'
