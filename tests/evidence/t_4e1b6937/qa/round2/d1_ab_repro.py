#!/usr/bin/env python3
"""Replicate the A-then-B sequence from d1_r2_sensitivity.py, dumping FULL vitest output."""
import os
import subprocess

QA = "/home/sap/.hermes/kanban/workspaces/t_4e1b6937/qa_r2"
CLONE = f"{QA}/pm"
WEB = f"{CLONE}/apps/web"
ENV = dict(os.environ, PATH=f"{QA}/shim:" + os.environ["PATH"])
SPEC_REL = "apps/web/src/api/envelope.test.ts"
ERRORS_REL = "apps/web/src/api/errors.ts"
TOKEN = "super-secret-jwt"


def run(label):
    p = subprocess.run("pnpm exec vitest run src/api/envelope.test.ts 2>&1", cwd=WEB, env=ENV,
                       shell=True, capture_output=True, text=True)
    out = p.stdout + p.stderr
    with open(f"{QA}/scenario_{label}.log", "w") as fh:
        fh.write(f"exit={p.returncode}\n{out}")
    print(f"{label}: exit={p.returncode}  bytes={len(out)}")
    return out


def restore():
    subprocess.run(["git", "restore", "--", SPEC_REL, ERRORS_REL], cwd=CLONE, check=True)


def stat(rel):
    p = subprocess.run(f"wc -c {CLONE}/{rel}", shell=True, capture_output=True, text=True)
    return p.stdout.strip()


# A: fixed spec + M10
restore()
print("A sizes:", stat(SPEC_REL))
with open(f"{CLONE}/{ERRORS_REL}") as fh:
    err = fh.read()
old = "    documentationUrl: body?.documentationUrl,"
with open(f"{CLONE}/{ERRORS_REL}", "w") as fh:
    fh.write(err.replace(old, f"    documentationUrl: body?.documentationUrl ?? 'Bearer {TOKEN}',"))
run("A")

# B: pre-fix spec + M10
restore()
pre = subprocess.run(["git", "show", f"9709272:{SPEC_REL}"], cwd=CLONE, capture_output=True, text=True)
with open(f"{CLONE}/{SPEC_REL}", "w") as fh:
    fh.write(pre.stdout)
with open(f"{CLONE}/{ERRORS_REL}") as fh:
    err = fh.read()
with open(f"{CLONE}/{ERRORS_REL}", "w") as fh:
    fh.write(err.replace(old, f"    documentationUrl: body?.documentationUrl ?? 'Bearer {TOKEN}',"))
print("B sizes:", stat(SPEC_REL))
out = run("B")
print("---- B output (first 60 lines) ----")
for line in out.splitlines()[:60]:
    print(line)
restore()
print("final status:", subprocess.run(["git", "status", "--porcelain"], cwd=CLONE,
                                      capture_output=True, text=True).stdout.strip() or "clean")
