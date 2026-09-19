#!/bin/bash
# t_d20787de — mirror the committed evidence bundle into the worker's scratch workspace so that every path
# named in this card's own verdict comment resolves at completion time (the hook resolves claims against the
# worker's cwd), and byte-compare the mirror against the repo copy.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_d20787de
REPO_EV=/home/sap/password-manager-check/.worktrees/t_d20787de/tests/evidence/t_d20787de
mkdir -p "$WS/tests/evidence"
cp -r "$REPO_EV" "$WS/tests/evidence/"
echo "=== mirror ==="
find "$WS/tests/evidence/t_d20787de" -type f | wc -l
echo "=== byte-compare every file ==="
FAILED=0
while IFS= read -r f; do
  rel="${f#$REPO_EV/}"
  if cmp -s "$f" "$WS/tests/evidence/t_d20787de/$rel"; then :; else echo "  DIFFERS: $rel"; FAILED=$((FAILED+1)); fi
done < <(find "$REPO_EV" -type f)
echo "files compared: $(find "$REPO_EV" -type f | wc -l)  differing: $FAILED"
echo
echo "=== claimed paths exist relative to the workspace? ==="
for p in tests/evidence/t_d20787de/README.md tests/evidence/t_d20787de/audit-t0.txt \
         tests/evidence/t_d20787de/audit-t1.txt tests/evidence/t_d20787de/audit-t2.txt \
         tests/evidence/t_d20787de/audit-diff.txt tests/evidence/t_d20787de/comment-readback-diff.txt; do
  if [ -e "$WS/$p" ]; then echo "  ok      $p"; else echo "  MISSING $p"; fi
done
