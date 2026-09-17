#!/usr/bin/env bash
# Read the QA sign-off gate's accepted verdict vocabulary + required comment format.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
cd "$WS/repo.git" || exit 1
echo "=== verdict vocabulary in signoff-gate.mjs ==="
git show refs/heads/feature/t_430aa9a3:scripts/qa/signoff-gate.mjs | grep -n -i "pass-with-conditions\|VERDICT_RE\|vocabulary\|fail\b" | head -40
echo
echo "=== policy: recording protocol section ==="
git show refs/heads/feature/t_430aa9a3:QA_SIGN_OFF_GATE.md | sed -n '1,45p'
