#!/bin/bash
# t_d20787de — which refs carry QA_SIGN_OFF_GATE.md, and do they reference the t_527d4720 runner decision?
set -u
cd /home/sap/password-manager-check || exit 1
echo "=== refs carrying QA_SIGN_OFF_GATE.md ==="
git for-each-ref --format='%(refname)' refs/remotes/origin | grep -v HEAD | while read -r ref; do
  if git cat-file -e "$ref:QA_SIGN_OFF_GATE.md" 2>/dev/null; then
    hits=$(git show "$ref:QA_SIGN_OFF_GATE.md" | grep -c -i "self-hosted\|QA_SIGNOFF_AUDIT_RUNNER")
    item1=$(git show "$ref:QA_SIGN_OFF_GATE.md" | sed -n '/^## 10\./,/^## 11\./p' | sed -n '4,5p' | tr -s ' ')
    echo "  $ref  runner_refs=$hits"
    echo "      item1: ${item1:0:200}"
  fi
done
