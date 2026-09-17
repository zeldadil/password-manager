#!/usr/bin/env bash
# Emit the verification fingerprint + timestamps used in the QA evidence file.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
cd "$WS/repo.git" || exit 1
PAT='[0-9]{8,12}:[A-Za-z0-9_-]{35}'
T=$(git show a503e4d3601762619fa751138a4b360ea65621f6:PROJECT_BRIEF.md | grep -oE "$PAT" | head -1)
echo "utc_now=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "token_sha256=$(printf '%s' "$T" | sha256sum | awk '{print $1}')"
echo "token_len=${#T}"
echo "gitleaks_version=$(gitleaks version 2>/dev/null)"
echo "trufflehog_version=$(trufflehog --version 2>/dev/null | head -1)"
echo "mirror_head=$(git rev-parse HEAD 2>/dev/null || echo n/a)"
echo "public_branch_count=$(git for-each-ref --format='%(refname)' refs/heads | wc -l)"
