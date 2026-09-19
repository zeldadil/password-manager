#!/usr/bin/env bash
# Dependency-link evidence for SEC-001 acceptance criterion 5.
set -uo pipefail
DB="$HOME/.hermes/kanban.db"
echo "### direct children of SEC-001 (t_9840ccdd)"
sqlite3 -column -header -- "$DB" "SELECT l.child_id, t.title, t.status FROM task_links l JOIN tasks t ON t.id=l.child_id WHERE l.parent_id='t_9840ccdd' ORDER BY l.child_id;"
echo
echo "### children of BE-002a (t_16f8ad84)"
sqlite3 -column -header -- "$DB" "SELECT l.child_id, t.title FROM task_links l JOIN tasks t ON t.id=l.child_id WHERE l.parent_id='t_16f8ad84' ORDER BY l.child_id;"
echo
echo "### children of BE-003a (t_fe3b76ea)"
sqlite3 -column -header -- "$DB" "SELECT l.child_id, t.title FROM task_links l JOIN tasks t ON t.id=l.child_id WHERE l.parent_id='t_fe3b76ea' ORDER BY l.child_id;"
echo
echo "### children of BR-002a (t_83dc1b35)"
sqlite3 -column -header -- "$DB" "SELECT l.child_id, t.title FROM task_links l JOIN tasks t ON t.id=l.child_id WHERE l.parent_id='t_83dc1b35' ORDER BY l.child_id;"
echo
echo "### parents of FE-002a (t_3b58b7ef)"
sqlite3 -column -header -- "$DB" "SELECT l.parent_id, t.title FROM task_links l JOIN tasks t ON t.id=l.parent_id WHERE l.child_id='t_3b58b7ef';"
echo
echo "### parents of FE-003a (t_a9d5cb1b)"
sqlite3 -column -header -- "$DB" "SELECT l.parent_id, t.title FROM task_links l JOIN tasks t ON t.id=l.parent_id WHERE l.child_id='t_a9d5cb1b';"
echo
echo "### parents of BR-003a (t_4b263ba0)"
sqlite3 -column -header -- "$DB" "SELECT l.parent_id, t.title FROM task_links l JOIN tasks t ON t.id=l.parent_id WHERE l.child_id='t_4b263ba0';"
echo
echo "### every task whose title starts BE-002/BE-003/BR-002/BR-003/FE-002/FE-003 and its parents"
sqlite3 -column -- "$DB" "SELECT t.id, substr(t.title,1,46), GROUP_CONCAT(l.parent_id,' ') FROM tasks t LEFT JOIN task_links l ON l.child_id=t.id WHERE t.title GLOB 'BE-002*' OR t.title GLOB 'BE-003*' OR t.title GLOB 'BR-002*' OR t.title GLOB 'BR-003*' OR t.title GLOB 'FE-002*' OR t.title GLOB 'FE-003*' GROUP BY t.id ORDER BY t.id;"
