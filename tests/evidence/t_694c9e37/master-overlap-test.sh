#!/usr/bin/env bash
# t_694c9e37 AC2 (master side) — right after a merge lands on master, trigger two more
# CI runs on master (workflow_dispatch, same ref refs/heads/master, hence the same
# concurrency evaluation as a push). Under the old config (group ci-CI-refs/heads/master,
# cancel-in-progress: true) each new run cancelled the previous one; with the fix all
# overlapping master runs must complete.
# Usage: bash tests/evidence/t_694c9e37/master-overlap-test.sh <merge_sha>
set -euo pipefail
MERGE_SHA="$1"
# wait for the push run of the merge commit to be in progress
for i in $(seq 1 30); do
  ST=$(gh run list --branch master --workflow CI --event push --json headSha,status --jq ".[] | select(.headSha==\"$MERGE_SHA\") | .status" | head -1)
  [ "$ST" = "in_progress" ] && break
  sleep 4
done
echo "push run of $MERGE_SHA: ${ST:-none} at $(date -u +%FT%TZ)"
gh workflow run CI --ref master
sleep 8
gh workflow run CI --ref master
echo "two workflow_dispatch runs requested on master at $(date -u +%FT%TZ)"
