#!/usr/bin/env python3
"""Print the `run: |` body of one step of a GitHub Actions workflow, de-indented.

Usage: extract-step.py WORKFLOW.yml "<step name>"
Stdlib only (no PyYAML on the host): finds `- name: <step name>`, then the
step's `run: |` block, and returns its lines with the block indentation
removed. `${{ ... }}` expressions are left as-is; the caller substitutes them.
"""
import sys

path, name = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf8").read().split("\n")
i = next(k for k, l in enumerate(lines) if l.strip() == f"- name: {name}")
step_indent = len(lines[i]) - len(lines[i].lstrip())
j = i + 1
while not lines[j].strip().startswith("run: |"):
    if lines[j].strip().startswith("- ") and len(lines[j]) - len(lines[j].lstrip()) <= step_indent:
        sys.exit(f"step {name!r} has no run: block")
    j += 1
run_indent = len(lines[j]) - len(lines[j].lstrip())
body = []
k = j + 1
block_indent = None
while k < len(lines):
    l = lines[k]
    if l.strip() == "":
        body.append("")
        k += 1
        continue
    ind = len(l) - len(l.lstrip())
    if ind <= run_indent:
        break
    if block_indent is None:
        block_indent = ind
    body.append(l[block_indent:])
    k += 1
while body and body[-1] == "":
    body.pop()
print("\n".join(body))
