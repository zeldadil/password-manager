#!/usr/bin/env bash
# reproduce.sh — t_0af5aa3e post-rotation re-verification (QA)
#
# Reproduces every claim in QA-VERDICT-ROTATION.md from scratch against the PUBLIC repo.
# Prints NO secret value: the old value is only ever held in a shell variable, the new value
# is only ever held in a shell variable read from the board DB.
#
# Usage: bash reproduce.sh [workdir]        (default: /tmp/qa-t_0af5aa3e-repro)
set -u
REPO=https://github.com/zeldadil/password-manager.git
W="${1:-/tmp/qa-t_0af5aa3e-repro}"
PAT='[0-9]{8,12}:[A-Za-z0-9_-]{35}'
OLD_FP=62fe6fe5053a50ec0570f5845ccd0ad39ea048c24239ae677c8eaa9a082e4aff
mkdir -p "$W"; cd "$W" || exit 1
rm -rf repo.git checkout
echo "### date: $(date -u)"
echo "### step 1 — fresh mirror clone (the only valid basis for a remote-purge check)"
git clone --mirror "$REPO" repo.git >/dev/null 2>&1
git clone "$REPO" checkout >/dev/null 2>&1
echo "master tip : $(git -C repo.git rev-parse --short refs/heads/master)"
echo "branches   : $(git -C repo.git for-each-ref refs/heads | wc -l)"

echo
echo "### step 2 — credential liveness (old value read from public history, never printed)"
OLD=$(git -C repo.git show a503e4d3601762619fa751138a4b360ea65621f6:PROJECT_BRIEF.md | grep -oE "$PAT" | head -1)
echo "old value sha256 : $(printf '%s' "$OLD" | sha256sum | cut -d' ' -f1)  (expect $OLD_FP)"
echo -n "Telegram getMe   : "
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 "https://api.telegram.org/bot${OLD}/getMe"
unset OLD

echo
echo "### step 3 — full-history scans, all refs"
gitleaks detect --source repo.git --no-banner --redact --report-format json \
  --report-path gitleaks.json >/dev/null 2>&1
echo "gitleaks (pattern) findings by rule:"
jq -r '.[].RuleID' gitleaks.json 2>/dev/null | sort | uniq -c
trufflehog git "file://$W/checkout" --results=verified,unknown --json > th.jsonl 2>th.err
echo "truffleHog (verification) findings: $(wc -l < th.jsonl)  (verified: $(jq -r '.Verified' th.jsonl 2>/dev/null | grep -c true))"
grep -o '"verified_secrets":[0-9]*' th.err | tail -1

echo
echo "### step 4 — per-ref tip exposure (branch tips)"
n=0; t=0
for ref in $(git -C repo.git for-each-ref --format='%(refname)' refs/heads); do
  t=$((t+1))
  c=$(git -C repo.git grep -E "$PAT" "$ref" -- PROJECT_BRIEF.md 2>/dev/null | wc -l)
  [ "$c" -gt 0 ] && { echo "  $ref EXPOSED"; n=$((n+1)); }
done
echo "branch tips still carrying the string: $n / $t"

echo
echo "### step 5 — history reachability (dead string in history)"
for c in a503e4d3601762619fa751138a4b360ea65621f6 543c396d8bf4289492b80066a93e8c9f51de8c2a; do
  git -C repo.git merge-base --is-ancestor "$c" refs/heads/master \
    && echo "  ${c:0:7} REACHABLE from master" || echo "  ${c:0:7} not reachable from master"
done
echo "  refs/pull/*/merge or head still exposing the string:"
git -C repo.git for-each-ref --format='%(refname)' refs/pull | while read -r r; do
  c=$(git -C repo.git grep -E "$PAT" "$r" -- PROJECT_BRIEF.md 2>/dev/null | wc -l)
  [ "$c" -gt 0 ] && echo "    $r"
done

echo
echo "### step 6 — is the rotated token live? (value read from the board comment, never printed)"
NEW=$(sqlite3 "$HOME/.hermes/kanban.db" \
  "select body from task_comments where task_id='t_0af5aa3e' and author='dashboard' order by created_at desc limit 1;" \
  | grep -oE "$PAT" | head -1)
echo -n "Telegram getMe (rotated token): "
curl -sS -o new.json -w '%{http_code}' --max-time 20 "https://api.telegram.org/bot${NEW}/getMe"
jq -r '"  bot=\(.result.username) id=\(.result.id)"' new.json 2>/dev/null
unset NEW

echo
echo "### step 7 — do the agent profiles use the rotated token?"
for f in "$HOME"/.hermes/profiles/*/.env; do
  p=$(basename "$(dirname "$f")")
  v=$(grep -oE "$PAT" "$f" 2>/dev/null | head -1)
  [ -z "${v:-}" ] && { printf '  %-10s <no token>\n' "$p"; continue; }
  fp=$(printf '%s' "$v" | sha256sum | cut -d' ' -f1)
  case "$fp" in
    "$OLD_FP") printf '  %-10s DEAD token still in .env (channel down)\n' "$p" ;;
    *)         printf '  %-10s rotated value present\n' "$p" ;;
  esac
  unset v
done
echo -n "  live send test: "
timeout 60 hermes send --to telegram:956145756 "reproduce.sh liveness probe" >/dev/null 2>&1 \
  && echo "OK (channel restored)" || echo "FAILED (Unauthorized — channel down)"

echo
echo "### step 8 — CI secret-scan on master (post-rotation)"
gh run list --repo zeldadil/password-manager --branch master --limit 1 \
  --json databaseId,headSha,conclusion 2>/dev/null | jq -c '.[]'
