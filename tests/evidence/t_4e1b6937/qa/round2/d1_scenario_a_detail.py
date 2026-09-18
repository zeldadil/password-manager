#!/usr/bin/env python3
"""Capture the observed failure detail for scenario A (fixed spec + M10).

Proves the spec does not merely fail: the failing assertion shows the token marker
sitting in the thrown ApiError, i.e. the assertion is the live sensor for that leak.
"""
import os
import subprocess

QA = "/home/sap/.hermes/kanban/workspaces/t_4e1b6937/qa_r2"
CLONE = f"{QA}/pm"
WEB = f"{CLONE}/apps/web"
ENV = dict(os.environ, PATH=f"{QA}/shim:" + os.environ["PATH"])
SPEC_REL = "apps/web/src/api/envelope.test.ts"
ERRORS_REL = "apps/web/src/api/errors.ts"

subprocess.run(["git", "restore", "--", SPEC_REL, ERRORS_REL], cwd=CLONE, check=True)
with open(f"{CLONE}/{ERRORS_REL}") as fh:
    err = fh.read()
old = "    documentationUrl: body?.documentationUrl,"
new = "    documentationUrl: body?.documentationUrl ?? 'Bearer super-secret-jwt',"
assert err.count(old) == 1
with open(f"{CLONE}/{ERRORS_REL}", "w") as fh:
    fh.write(err.replace(old, new))

p = subprocess.run("pnpm exec vitest run src/api/envelope.test.ts 2>&1", cwd=WEB, env=ENV,
                   shell=True, capture_output=True, text=True)
out = p.stdout + p.stderr
with open(f"{QA}/scenario_A_full.log", "w") as fh:
    fh.write(f"exit={p.returncode}\n{out}")
print("exit:", p.returncode)
interesting = [l.rstrip() for l in out.splitlines()
               if "AssertionError" in l or "documentationUrl" in l or "token-marker" in l
               or "never echoes" in l or "Tests " in l or "Test Files" in l]
for line in interesting[:25]:
    print("  ", line)
subprocess.run(["git", "restore", "--", SPEC_REL, ERRORS_REL], cwd=CLONE, check=True)
print("reverted; status:",
      subprocess.run(["git", "status", "--porcelain"], cwd=CLONE,
                     capture_output=True, text=True).stdout.strip() or "clean")
