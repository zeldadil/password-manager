#!/usr/bin/env bash
# Acceptance criterion 2 — every evidence path named by each card's operative
# (newest) verdict comment must be resolvable on some ref of the clone, and no
# /tmp or workspace-only pointer may remain operative.
set -uo pipefail
DB="${HERMES_KANBAN_DB:-$HOME/.hermes/kanban.db}"
REPO="${REPO:-/home/sap/qa-retrofit-clone}"
cd "$REPO" || exit 1

# The gate's own path regexes (signoff-gate.mjs §EVIDENCE_*), kept in sync:
PATH_RE='(tests|apps|packages|scripts|docs|architecture|\.github)/[][[:alnum:]._@/-]*\.[a-z0-9]{1,8}'

rc=0
for id in t_9840ccdd t_3ca45da2 t_08b02da9 t_ac6a1f3f t_a2cf1744 t_5fe41426; do
  echo "=================================================================== $id"
  sqlite3 -- "$DB" "SELECT body FROM task_comments WHERE task_id='$id' ORDER BY created_at DESC, id DESC LIMIT 1;" > /tmp/c2-body.txt
  echo "--- operative verdict line:"
  head -1 /tmp/c2-body.txt
  echo "--- repo-relative paths named in the operative verdict:"
  grep -oE "$PATH_RE" /tmp/c2-body.txt | sort -u > /tmp/c2-paths.txt
  if [ ! -s /tmp/c2-paths.txt ]; then echo "  *** NONE FOUND — R4/R5 would fire ***"; rc=1; fi
  while IFS= read -r p; do
    sha=$(git rev-list --max-count=1 --all -- "$p")
    if [ -n "$sha" ]; then
      printf '  OK    %-52s %s\n' "$p" "$sha"
    else
      printf '  ABSENT %-51s NOT-ON-ANY-REF\n' "$p"
      rc=1
    fi
  done < /tmp/c2-paths.txt
  echo "--- absolute-path pointers in the operative verdict (must be none):"
  if grep -qE '(^|[[:space:]`("'"'"'[])/[[:alnum:]._/@-]+\.[a-z0-9]{1,8}' /tmp/c2-body.txt; then
    echo "  *** ABSOLUTE PATH PRESENT ***"; grep -oE '(^|[[:space:]`("'"'"'[])/[[:alnum:]._/@-]+\.[a-z0-9]{1,8}' /tmp/c2-body.txt; rc=1
  else
    echo "  none"
  fi
done
echo
echo "criterion-2 check rc=$rc (0 = every operative evidence path resolves on a ref, no absolute pointers)"
exit $rc
