#!/usr/bin/env python3
"""Round-2 independent sensitivity check for D1 (FE-001i, t_4e1b6937).

Runs on a FRESH clone of feature/t_4e1b6937 @ 823d7ab (qa_r2/pm), never on the
implementer's workspace. Each mutation is applied to a source file (or the spec),
the focused spec is run, and the tree is restored from HEAD afterwards.

Scenarios
  A  FIXED spec  + M10 (token in the documentationUrl fallback)      -> must FAIL
  B  PRE-FIX spec + M10 (same mutation, spec as at 9709272)          -> must PASS (defect reproduces)
  C  FIXED spec  + M13 (token appended to the envelope error message)-> must FAIL
  D  FIXED spec  + M12 (token in the generic non-envelope branch)    -> must FAIL
  E  FIXED spec  + degraded fixture (shared Response per call)       -> must FAIL (fixture guard is live)
  F  FIXED spec  + no mutation                                       -> must PASS, tree clean
"""
import os
import re
import subprocess
import sys

QA = "/home/sap/.hermes/kanban/workspaces/t_4e1b6937/qa_r2"
CLONE = f"{QA}/pm"
WEB = f"{CLONE}/apps/web"
SRC = f"{WEB}/src"
ENV = dict(os.environ, PATH=f"{QA}/shim:" + os.environ["PATH"])
TOKEN = "super-secret-jwt"  # must equal the spec's accessToken: the assertion checks that value
SPEC_REL = "apps/web/src/api/envelope.test.ts"
ERRORS_REL = "apps/web/src/api/errors.ts"
CLIENT_REL = "apps/web/src/api/client.ts"
TOUCHED = [SPEC_REL, ERRORS_REL, CLIENT_REL]


def sh(cmd, cwd=WEB):
    p = subprocess.run(cmd, cwd=cwd, env=ENV, shell=True, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def head_text(ref):
    rc, out = sh(f"git show {ref}", cwd=CLONE)
    assert rc == 0, f"git show {ref} failed: {out!r}"
    return out


def restore():
    subprocess.run(["git", "restore", "--", *TOUCHED], cwd=CLONE, check=True)


def read(p):
    with open(p) as fh:
        return fh.read()


def write(p, t):
    with open(p, "w") as fh:
        fh.write(t)


def mutate(rel, old, new, count=1):
    p = f"{CLONE}/{rel}"
    text = read(p)
    n = text.count(old)
    assert n == count, f"anchor count {n} != {count} in {rel}: {old!r}"
    write(p, text.replace(old, new))


def run_spec(label, expect):
    rc, out = sh("pnpm exec vitest run src/api/envelope.test.ts 2>&1")
    files = re.search(r"Test Files\s+(.+)", out)
    tests = re.search(r"Tests\s+(.+)", out)
    names = re.findall(r"^\s*(?:×|FAIL).*?(never echoes.*)$", out, re.M)
    verdict = "PASS" if rc == 0 else "FAIL"
    ok = (verdict == "PASS" and expect == "pass") or (verdict == "FAIL" and expect == "fail")
    print(f"\n=== {label}")
    print(f"    expected {expect.upper()} -> got {verdict} (exit {rc})")
    print(f"    {files.group(0) if files else 'no file summary'}")
    print(f"    {tests.group(0) if tests else 'no test summary'}")
    for n in names[:4]:
        print(f"      failing: {n.strip()}")
    if not ok:
        print("    --- raw vitest tail ---")
        for line in out.strip().splitlines()[-20:]:
            print(f"    | {line}")
    print(f"    AS EXPECTED: {'yes' if ok else 'NO <<< PROBLEM'}")
    return ok


results = []

# A ---------------------------------------------------------------------------
restore()
mutate(ERRORS_REL, "    documentationUrl: body?.documentationUrl,",
       f"    documentationUrl: body?.documentationUrl ?? 'Bearer {TOKEN}',")
results.append(("A fixed spec + M10", run_spec("A  FIXED spec + M10 (token into documentationUrl fallback)", "fail")))

# B ---------------------------------------------------------------------------
restore()
write(f"{CLONE}/{SPEC_REL}", head_text("9709272:" + SPEC_REL))
mutate(ERRORS_REL, "    documentationUrl: body?.documentationUrl,",
       f"    documentationUrl: body?.documentationUrl ?? 'Bearer {TOKEN}',")
results.append(("B pre-fix spec + M10", run_spec("B  PRE-FIX spec (9709272) + M10 -- must stay green (defect reproduces)", "pass")))

# C ---------------------------------------------------------------------------
restore()
mutate(ERRORS_REL, "  return new ApiError({\n    message,\n    kind: 'http',",
       f"  return new ApiError({{\n    message: `${{message}} Bearer {TOKEN}`,\n    kind: 'http',")
results.append(("C fixed spec + M13", run_spec("C  FIXED spec + M13 (token appended to envelope message)", "fail")))

# D ---------------------------------------------------------------------------
restore()
mutate(CLIENT_REL, "      message: `Request failed with status ${response.status}`,",
       f"      message: `Request failed with status ${{response.status}} Bearer {TOKEN}`,")
results.append(("D fixed spec + M12", run_spec("D  FIXED spec + M12 (token in generic non-envelope branch)", "fail")))

# E ---------------------------------------------------------------------------
restore()
mutate(SPEC_REL,
       "const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(unauthorizedEnvelope()))\n    const client = buildClient(makeFetch(fetchMock), store)\n\n    const error = await client.get('/resources').catch((e: unknown) => e)\n\n    // Fixture guard",
       "const fetchMock = vi.fn().mockResolvedValue(unauthorizedEnvelope())\n    const client = buildClient(makeFetch(fetchMock), store)\n\n    const error = await client.get('/resources').catch((e: unknown) => e)\n\n    // Fixture guard")
results.append(("E fixed spec + degraded fixture", run_spec("E  FIXED spec + degraded fixture (shared Response) -- guard must catch it", "fail")))

# F ---------------------------------------------------------------------------
restore()
results.append(("F fixed spec, clean", run_spec("F  FIXED spec, no mutation", "pass")))
rc, status = sh("git status --porcelain", cwd=CLONE)
print(f"\n=== git status --porcelain after restore: {status.strip()!r}")

print("\n=== SUMMARY")
bad = 0
for label, ok in results:
    print(f"  {'OK ' if ok else 'BAD'}  {label}")
    if not ok:
        bad += 1
sys.exit(1 if bad or status.strip() else 0)
