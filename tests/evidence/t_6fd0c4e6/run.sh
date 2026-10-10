#!/usr/bin/env bash
# t_6fd0c4e6 reproduce: run from this directory (needs README.d577aa4.md / README.master.md extracted by git show)
set -u
cd "$(dirname "$0")"
echo "== d577aa4 (PR #132 squash) =="
MERMAID_OUT=mermaid.d577aa4.mmd python3 validate.py README.d577aa4.md; echo "exit=$?"
echo
echo "== origin/master a56dc76 (after dd7ec14) =="
MERMAID_OUT=mermaid.master.mmd python3 validate.py README.master.md; echo "exit=$?"
echo
echo "== negative control: Prerequisites moved before Architecture Diagram, unclosed quote in a Quick Start block =="
python3 make_control.py README.d577aa4.md "$SCRATCH/README.control.md"
python3 validate.py "$SCRATCH/README.control.md"; echo "exit=$?"
