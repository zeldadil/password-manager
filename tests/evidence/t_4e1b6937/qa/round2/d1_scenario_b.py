#!/usr/bin/env python3
"""Reproduce scenario B alone with the full vitest output (pre-fix spec @9709272)."""
import os
import subprocess

QA = "/home/sap/.hermes/kanban/workspaces/t_4e1b6937/qa_r2"
CLONE = f"{QA}/pm"
WEB = f"{CLONE}/apps/web"
ENV = dict(os.environ, PATH=f"{QA}/shim:" + os.environ["PATH"])
SPEC_REL = "apps/web/src/api/envelope.test.ts"
ERRORS_REL = "apps/web/src/api/errors.ts"

pre = subprocess.run(["git", "show", f"9709272:{SPEC_REL}"], cwd=CLONE,
                     capture_output=True, text=True)
print("git show exit:", pre.returncode, "stderr:", pre.stderr.strip(), "bytes:", len(pre.stdout))
with open(f"{CLONE}/{SPEC_REL}", "w") as fh:
    fh.write(pre.stdout)

with open(f"{CLONE}/{ERRORS_REL}") as fh:
    err = fh.read()
old = "    documentationUrl: body?.documentationUrl,"
new = "    documentationUrl: body?.documentationUrl ?? 'Bearer super-secret-jwt',"
assert err.count(old) == 1
with open(f"{CLONE}/{ERRORS_REL}", "w") as fh:
    fh.write(err.replace(old, new))

p = subprocess.run("pnpm exec vitest run src/api/envelope.test.ts 2>&1", cwd=WEB, env=ENV,
                   shell=True, capture_output=True, text=True)
print("vitest exit:", p.returncode)
print("---- FULL OUTPUT ----")
print(p.stdout + p.stderr)
subprocess.run(["git", "restore", "--", SPEC_REL, ERRORS_REL], cwd=CLONE, check=True)
print("reverted; status:", subprocess.run(["git", "status", "--porcelain"], cwd=CLONE,
                                          capture_output=True, text=True).stdout.strip() or "clean")
