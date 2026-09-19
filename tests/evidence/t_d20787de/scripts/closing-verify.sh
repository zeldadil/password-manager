#!/bin/bash
# t_d20787de — closing verification: prove the live board changed ONLY by this card's seven comments,
# and that the pushed branch carries the evidence the verdict comment claims.
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
CD=/home/sap/password-manager-check
bash "$SCR/snapshot-board.sh" t3 > "$SCR/snapshot-t3.txt" 2>&1
{
echo "=== task rows: t0 copy vs live now (t3) ==="
python3 - <<'PY'
import sqlite3
a = sqlite3.connect("file:/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch/board-t0.db?mode=ro", uri=True)
b = sqlite3.connect("file:/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch/board-t3.db?mode=ro", uri=True)
q = "SELECT id,title,assignee,status,completed_at,priority,created_at FROM tasks ORDER BY id"
ra, rb = a.execute(q).fetchall(), b.execute(q).fetchall()
da = {r[0]: r for r in ra}
db = {r[0]: r for r in rb}
added = sorted(set(db) - set(da))
removed = sorted(set(da) - set(db))
changed = [k for k in sorted(set(da) & set(db)) if da[k] != db[k]]
print(f"  tasks t0={len(ra)} t3={len(rb)}  added={added}  removed={removed}")
print(f"  rows changed between t0 and t3: {len(changed)}")
for k in changed:
    print(f"    {k}")
    print(f"      t0: {da[k]}")
    print(f"      t3: {db[k]}")
print("  six in-scope cards still identical (assignee/status/completed_at untouched):")
for c in ["t_e348e0b7","t_28951254","t_2162d273","t_527d4720","t_80fc0326","t_c3cb6842"]:
    same = da.get(c) == db.get(c)
    print(f"    {c}: {'UNCHANGED' if same else 'CHANGED'}  (assignee={db.get(c, [None, None, None])[2] if c in db else '?'}, status={(db.get(c) or [None,None,None,None])[3]})")
PY
echo
echo "=== comment delta: which comments exist in t3 but not in t0 ==="
sqlite3 -- "$SCR/board-t3.db" "ATTACH '/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch/board-t0.db' AS t0; SELECT 'added  '||id||' | '||task_id||' | '||author||' | '||length(body) FROM main.task_comments WHERE id NOT IN (SELECT id FROM t0.task_comments) ORDER BY id;"
sqlite3 -- "$SCR/board-t3.db" "ATTACH '/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch/board-t0.db' AS t0; SELECT 'removed '||id||' | '||task_id||' | '||author FROM t0.task_comments WHERE id NOT IN (SELECT id FROM main.task_comments) ORDER BY id;" || true
echo "  (no 'removed' rows = no comment was deleted)"
echo
echo "=== pushed branch: does it carry every path the verdict comment claims? ==="
cd "$CD" || exit 1
git fetch origin qa/t_d20787de-retro-verify >/dev/null 2>&1
for p in tests/evidence/t_d20787de/README.md tests/evidence/t_d20787de/audit-t0.txt tests/evidence/t_d20787de/audit-t1.txt tests/evidence/t_d20787de/audit-t2.txt tests/evidence/t_d20787de/audit-diff.txt tests/evidence/t_d20787de/comment-readback-diff.txt; do
  if git cat-file -e "origin/qa/t_d20787de-retro-verify:$p" 2>/dev/null; then
    echo "  ok  $(git cat-file -s "origin/qa/t_d20787de-retro-verify:$p") bytes  $p"
  else
    echo "  MISSING on the pushed branch: $p"
  fi
done
echo "  branch tip: $(git rev-parse origin/qa/t_d20787de-retro-verify)"
echo
echo "=== workspace mirror still in place (completion-hook root) ==="
ls /home/sap/.hermes/kanban/workspaces/t_d20787de/tests/evidence/t_d20787de/ | head
} 2>&1 | tee "$SCR/closing-verification.txt"
