#!/bin/bash
# t_d20787de — check the gate's evidence-pointer plumbing for the drafted verdict comments.
set -u
cd /home/sap/password-manager-check/.worktrees/t_d20787de || exit 1
echo "=== label + pointer regexes ==="
grep -n "EVIDENCE_LABEL_RE\s*=" -A 2 scripts/qa/signoff-gate.mjs
grep -n "const EVIDENCE_ABS_RE\|const EVIDENCE_DIR_RE\|const EVIDENCE_PATH_RE" -A 3 scripts/qa/signoff-gate.mjs
echo
echo "=== present in the audit worktree? ==="
for p in .github/workflows/ci.yml tests/evidence/t_e348e0b7/README.md tests/evidence/t_28951254/README.md "$HOME/.hermes/kanban/attachments/t_2162d273/decision.md"; do
  if [ -e "$p" ]; then echo "  present: $p"; else echo "  absent : $p"; fi
done
echo
echo "=== present on any ref? ==="
for p in .github/workflows/ci.yml tests/evidence/t_e348e0b7/README.md tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt tests/evidence/t_28951254/README.md docs/decisions/qa-signoff-gate-followups-t_527d4720.md scripts/qa/signoff-gate.mjs tests/evidence/t_d20787de/README.md; do
  n=$(git rev-list --all -- "$p" | wc -l)
  echo "  refs_containing=$n  $p"
done
