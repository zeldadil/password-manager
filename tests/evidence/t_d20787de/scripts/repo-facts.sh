#!/bin/bash
# t_d20787de — repository facts for the retro-verification. Read-only.
# Secret discipline: token-shaped strings are only ever COUNTED (grep -c), never printed.
set -u
REPO=/home/sap/password-manager-check
WT="$REPO/.worktrees/t_d20787de"
TOKPAT='[0-9]{8,12}:[A-Za-z0-9_-]{35}'
cd "$WT" || exit 1

echo "=== A. master tree, key artifacts ==="
git ls-tree -r --name-only origin/master | grep -E "^(scripts/|docs/|QA_SIGN_OFF|tests/evidence/t_e348e0b7/)" || echo "  (none)"
echo

echo "=== B. t_e348e0b7 — master .github/workflows/ci.yml: secret-scan + trufflehog + sast ==="
git show origin/master:.github/workflows/ci.yml > /tmp/t_d20787de-ci-master.yml
grep -n -E "^  [a-z-]+:|trufflehog|semgrep|gitleaks|results=verified|--fail" /tmp/t_d20787de-ci-master.yml | head -40
echo
echo "  --- secret-scan job body (master) ---"
awk '/^  secret-scan:/{f=1} f&&/^  [a-z-]+:/&&!/^  secret-scan:/{if(NR>1)f=0} f{print}' /tmp/t_d20787de-ci-master.yml | head -40
echo

echo "=== C. t_e348e0b7 — master allowlist files present? ==="
for f in .gitleaksignore .trufflehogignore .gitleaks.toml; do
  if git cat-file -e "origin/master:$f" 2>/dev/null; then echo "  PRESENT on master: $f"; else echo "  absent on master: $f"; fi
done
echo

echo "=== D. t_e348e0b7 — evidence on master + token-shaped strings in it (count only) ==="
for f in tests/evidence/t_e348e0b7/README.md tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt; do
  if git cat-file -e "origin/master:$f" 2>/dev/null; then
    n=$(git show "origin/master:$f" | grep -c -E "$TOKPAT")
    echo "  present on master: $f  token_shaped_lines=$n  bytes=$(git cat-file -s "origin/master:$f")"
  else
    echo "  ABSENT on master: $f"
  fi
done
echo

echo "=== E. t_c3cb6842 — master scripts/qa/signoff-gate.mjs: the tightened regex ==="
git show origin/master:scripts/qa/signoff-gate.mjs > /tmp/t_d20787de-gate-master.mjs
grep -n "VERDICT_MARKER_RE\|DEFERRAL_RE\|EXCEPTION_RE" /tmp/t_d20787de-gate-master.mjs | head -10
echo "  master blob: $(git rev-parse origin/master:scripts/qa/signoff-gate.mjs)  sha256=$(sha256sum /tmp/t_d20787de-gate-master.mjs | cut -d' ' -f1)"
echo "  installed   : $(sha256sum "$HOME/.hermes/profiles/qa/agent-hooks/signoff-gate.mjs" | cut -d' ' -f1)"
echo "  reviewed    : $(sha256sum scripts/qa/signoff-gate.mjs | cut -d' ' -f1)  (branch $(git branch --show-current) head $(git rev-parse --short HEAD))"
echo

echo "=== F. t_527d4720 — decision doc on any ref? ==="
git log --all --oneline -- docs/decisions/qa-signoff-gate-followups-t_527d4720.md | head -5
echo "  refs carrying docs/decisions/qa-signoff-gate-followups-t_527d4720.md:"
git rev-list --all -- docs/decisions/qa-signoff-gate-followups-t_527d4720.md | wc -l
git branch -a --contains "$(git rev-list --all -- docs/decisions/qa-signoff-gate-followups-t_527d4720.md | head -1)" 2>/dev/null | head -10
echo "  blob 145f5c1 exists? $(git cat-file -t 145f5c1 2>&1)"
echo "  docs/decision files across all refs:"
git rev-list --all --objects -- docs/decisions 2>/dev/null | head -20
echo

echo "=== G. QA_SIGN_OFF_GATE.md / hooks: which refs carry them ==="
for ref in origin/master qa/t_338f47fd-marker-author qa/t_58280940-r8-stale-deferral; do
  echo "  --- $ref"
  git ls-tree -r --name-only "$ref" 2>/dev/null | grep -E "QA_SIGN_OFF_GATE.md|scripts/qa/hooks/" | head -10
done
echo

echo "=== H. t_80fc0326 — remote branch tips carrying a token-shaped string (count only) ==="
DIRTY=0
TIPS=0
for ref in $(git for-each-ref --format='%(refname)' refs/remotes/origin | grep -v HEAD); do
  TIPS=$((TIPS+1))
  n=$(git grep -c -E "$TOKPAT" "$ref" 2>/dev/null | wc -l)
  if [ "$n" -gt 0 ]; then
    echo "  DIRTY $ref : $n file(s)"
    git grep -l -E "$TOKPAT" "$ref" 2>/dev/null | sed 's/^/      /'
    DIRTY=$((DIRTY+1))
  fi
done
echo "  remote-tracking branch tips scanned: $TIPS  dirty: $DIRTY"
echo
echo "=== I. GitHub's own branch tips (authoritative, ls-remote) ==="
git ls-remote --heads origin | wc -l
