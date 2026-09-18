#!/usr/bin/env python3
"""M12: is the secret-hygiene assertion sensitive to a leak in the *generic*
(non-envelope) error path? The probe proved it is blind to the envelope-derived
path; this pins down exactly which leak vector it does cover, so the review
finding is precise rather than overstated.
"""
import subprocess, os

QA = "/home/sap/.hermes/kanban/workspaces/t_4e1b6937"
CLONE = f"{QA}/qa_clone"
WEB = f"{CLONE}/apps/web"
ENV = dict(os.environ, PATH=f"{QA}/shim_qa:" + os.environ["PATH"])

OLD = """    return new ApiError({
      message: `Request failed with status ${response.status}`,
      kind: 'http',
      httpStatus: response.status,
    })"""
NEW = """    return new ApiError({
      message: `Request failed with status ${response.status}`,
      kind: 'http',
      httpStatus: response.status,
      documentationUrl: `Bearer ${this.tokenStore.getAccessToken() ?? ''}`,
    })"""

path = f"{WEB}/src/api/client.ts"
with open(path) as fh:
    text = fh.read()
assert OLD in text, "anchor missing"
with open(path, "w") as fh:
    fh.write(text.replace(OLD, NEW, 1))
print("M12 applied: generic 401 error path now carries the bearer token")

p = subprocess.run(
    "corepack pnpm@9.12.0 exec vitest run src/api/envelope.test.ts 2>&1",
    cwd=WEB, env=ENV, shell=True, capture_output=True, text=True,
)
summary = [l.strip() for l in p.stdout.splitlines() if "Test Files" in l or "Tests " in l]
print("spec result:", " | ".join(summary), "| exit", p.returncode)
print("verdict:", "FAILED -> assertion IS sensitive to generic-path leaks" if p.returncode else
      "PASSED -> assertion blind to this path too")

subprocess.run(["git", "restore", "--", "apps/web/src/api/client.ts"], cwd=CLONE, check=True)
print("restored:", subprocess.run(["git", "status", "--porcelain"], cwd=CLONE,
                                  capture_output=True, text=True).stdout.strip() or "clean")
