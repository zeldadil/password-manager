#!/usr/bin/env bash
# Publish QA evidence for t_0af5aa3e on a branch whose history is verified token-free.
# Base = origin/feat/t_527d4720-runner (filter-branch-rewritten AND force-pushed -> 0 token hits in history).
set -eu
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e
REPO=/home/sap/password-manager
WT="$REPO/.worktrees/t_0af5aa3e-qa"
BRANCH=qa/t_0af5aa3e-verdict
export PATH="$HOME/.local/bin:$PATH"

cd "$REPO"
git fetch origin feat/t_527d4720-runner 2>&1 | tail -2

if [ ! -d "$WT" ]; then
  git worktree add "$WT" -b "$BRANCH" origin/feat/t_527d4720-runner 2>&1 | tail -3
fi

mkdir -p "$WT/tests/evidence/t_0af5aa3e"
cp "$WS/artifacts/t_0af5aa3e/QA-VERDICT.md" "$WT/tests/evidence/t_0af5aa3e/QA-VERDICT.md"
cp "$WS/scripts"/*.sh "$WT/tests/evidence/t_0af5aa3e/"
chmod +x "$WT/tests/evidence/t_0af5aa3e"/*.sh

# Final guard: the evidence we publish must itself contain no token-like string.
echo "=== pre-commit leak guard on staged content ==="
if grep -rInE '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$WT/tests/evidence/t_0af5aa3e/"; then
  echo "ABORT: token-like string found in QA evidence — refusing to publish"
  exit 1
fi
echo "clean: no token-like strings in the QA evidence payload"

cd "$WT"
git add tests/evidence/t_0af5aa3e
git -c user.name=qa -c user.email=qa@example.com commit -q -m "QA-VERDICT t_0af5aa3e: FAIL — P0 token leak NOT remediated (22/28 public branch tips still expose it)

Independent re-verification from a fresh mirror clone of the public repo:
- Telegram getMe -> HTTP 200, token still LIVE
- gitleaks: 3 telegram-bot-api-token findings; truffleHog: 3 VERIFIED TelegramBotToken findings
- 22/28 branch tips and 24/28 branch histories still carry the raw token; master history included
- the previous remediation re-leaked the token into its own evidence file (public branch)
- master's secret-scan job is green despite the live leak (false negative)
No credential value appears in this commit." 2>&1 | tail -3

git push -u origin "$BRANCH" 2>&1 | tail -4

echo
echo "=== post-push verification ==="
git ls-remote origin "refs/heads/$BRANCH"
echo "--- branch history: token findings (expect 0) ---"
gitleaks detect --source "$WT" --no-banner --redact --report-format json \
  --report-path "$WS/verify/raw/gitleaks-qa-branch.json" 2>&1 | tail -3
echo "QA branch telegram findings: $(jq '[.[] | select(.RuleID=="telegram-bot-api-token")] | length' "$WS/verify/raw/gitleaks-qa-branch.json" 2>/dev/null)"
echo "QA branch total findings:    $(jq 'length' "$WS/verify/raw/gitleaks-qa-branch.json" 2>/dev/null)"
