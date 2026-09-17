#!/usr/bin/env bash
# QA independent verification — P0 SEC-INCIDENT t_0af5aa3e
# Fresh mirror clone of the PUBLIC repo, then full-history secret scan.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
mkdir -p "$WS"
cd "$WS" || exit 1
if [ ! -d repo.git ]; then
  git clone --mirror https://github.com/zeldadil/password-manager.git repo.git 2>&1 | tail -5
fi
cd repo.git || exit 1
echo "=== remote refs (public repo, as of scan) ==="
git for-each-ref --format='%(refname) %(objectname:short)' refs/heads | sort | head -60
echo
echo "=== count of remote branches ==="
git for-each-ref --format='%(refname)' refs/heads | wc -l
echo
echo "=== HEAD/default branch of public repo ==="
git symbolic-ref HEAD 2>/dev/null || echo "(no HEAD symref)"
echo
echo "=== default branch tip ==="
git log --oneline -3 refs/heads/master 2>/dev/null || echo "(no master ref)"
echo
echo "=== scan size ==="
du -sh .
