#!/usr/bin/env bash
# t_75180b28 — how often is the master CI run of a merge commit cancelled by the
# next push (ci.yml: concurrency group per ref, cancel-in-progress: true)?
# Prints, for the last N first-parent commits on origin/master, the required
# checks that are not success on that exact commit. Read-only.
#   bash tests/evidence/t_75180b28/master-ci-history.sh [N]
set -uo pipefail
n="${1:-30}"
repo="zeldadil/password-manager"
req="$(gh api "repos/$repo/branches/master/protection/required_status_checks" --jq '[.contexts[]] | join(",")')"
echo "required (branch protection): $req"
git fetch -q origin master
git log --first-parent --format='%H %s' -n "$n" origin/master > "${TMPDIR:-/tmp}/t75-master.txt"
while read -r sha subject; do
  states="$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" --jq "[.check_runs[] | select(.name as \$n | \"$req\" | split(\",\") | index(\$n)) | \"\(.name)=\(.conclusion // .status)\"] | join(\" \")")"
  bad="$(printf '%s\n' "$states" | tr ' ' '\n' | grep -v '=success$' | grep -v '^$' | tr '\n' ' ')"
  printf '%s  %-60.60s  %s\n' "${sha:0:12}" "$subject" "${bad:-all-required-green}"
done < "${TMPDIR:-/tmp}/t75-master.txt"
