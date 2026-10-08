#!/usr/bin/env bash
# t_694c9e37 AC2 (PR side) — two quick pushes on a PR branch: the run of the first
# push must end `cancelled`, the run of the second must run to completion.
# Run from the repo root, on the PR head branch. Pushes two empty commits.
# Usage: bash tests/evidence/t_694c9e37/pr-cancel-test.sh <branch>
set -euo pipefail
BR="$1"
git commit -q --allow-empty -m "test(t_694c9e37): PR-side concurrency probe 1/2 (empty commit)"
git push -q origin "$BR"
SHA1=$(git rev-parse HEAD)
# wait until the run of push 1 exists and is in progress, so the second push really overlaps it
for i in $(seq 1 30); do
  ST=$(gh run list --branch "$BR" --workflow CI --json headSha,status --jq ".[] | select(.headSha==\"$SHA1\") | .status" | head -1)
  [ "$ST" = "in_progress" ] && break
  sleep 4
done
echo "push1 $SHA1 status before push2: ${ST:-none}"
git commit -q --allow-empty -m "test(t_694c9e37): PR-side concurrency probe 2/2 (empty commit)"
git push -q origin "$BR"
SHA2=$(git rev-parse HEAD)
echo "push2 $SHA2"
echo "SHA1=$SHA1" > tests/evidence/t_694c9e37/pr-cancel-test.shas
echo "SHA2=$SHA2" >> tests/evidence/t_694c9e37/pr-cancel-test.shas
