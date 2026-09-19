#!/usr/bin/env python3
"""D1 sensitivity harness (FE-001i, t_4e1b6937).

Proves that the fixed `apps/web/src/api/envelope.test.ts` fails when a bearer token
is leaked into the *envelope-derived* ApiError, and that the pre-fix fixture did not.

Every mutation is applied to a source file, the spec is run, and the file is restored.
Nothing is committed from here.
"""
import re
import subprocess
import sys
from pathlib import Path

REPO = Path("/home/sap/.hermes/kanban/workspaces/t_4e1b6937/pm")
SPEC_REL = "apps/web/src/api/envelope.test.ts"
ERRORS_REL = "apps/web/src/api/errors.ts"
CLIENT_REL = "apps/web/src/api/client.ts"
TOUCHED = [SPEC_REL, ERRORS_REL, CLIENT_REL]

SPEC = REPO / SPEC_REL
ERRORS = REPO / ERRORS_REL
CLIENT = REPO / CLIENT_REL

TOKEN = "super-secret-jwt"


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO, check=True, capture_output=True, text=True
    ).stdout


# Snapshot the pristine (HEAD) and current (fixed) versions in memory.
HEAD = {rel: git("show", f"HEAD:{rel}") for rel in TOUCHED}
FIXED_SPEC = SPEC.read_text()


def restore_all() -> None:
    for rel in TOUCHED:
        (REPO / rel).write_text(HEAD[rel])
    SPEC.write_text(FIXED_SPEC)


def write(rel: str, text: str) -> None:
    (REPO / rel).write_text(text)


def mutate(rel: str, old: str, new: str) -> None:
    path = REPO / rel
    text = path.read_text()
    assert text.count(old) == 1, f"mutation anchor not unique in {rel}: {old!r}"
    path.write_text(text.replace(old, new))


def run_spec(label: str, expect: str) -> dict:
    proc = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "src/api/envelope.test.ts"],
        cwd=REPO / "apps/web",
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    passed = re.search(r"Tests\s+(\d+) passed", out)
    failed = re.search(r"Tests\s+(\d+) failed", out)
    total = re.search(r"Tests\s+(\d+) passed \((\d+)\)", out)
    # Failing test names, when any.
    names = re.findall(r"FAIL\s+(\S+)\s*>\s*(.+)", out)
    verdict = "PASS(exit 0)" if proc.returncode == 0 else f"FAIL(exit {proc.returncode})"
    ok = (verdict.startswith("PASS") and expect == "pass") or (
        verdict.startswith("FAIL") and expect == "fail"
    )
    n_pass = passed.group(1) if passed else "0"
    n_fail = failed.group(1) if failed else "0"
    n_total = total.group(2) if total else "?"
    print(f"\n=== {label}")
    print(f"    expected {expect.upper()} -> got {verdict}   {n_pass}/{n_total} passed, {n_fail} failed")
    if total is None:
        print("    --- raw vitest tail ---")
        for line in out.strip().splitlines()[-12:]:
            print(f"    | {line}")
    for cls, name in names[:4]:
        print(f"      failing: {cls} > {name.strip()}")
    print(f"    MUTATION KILLED: {'yes' if ok else 'NO <<< PROBLEM'} ")
    return {"label": label, "expect": expect, "verdict": verdict, "ok": ok}


results = []

# --- S0: fixed spec, no mutation -> must pass ------------------------------------
restore_all()
results.append(run_spec("S0  fixed spec, no mutation", "pass"))

# --- S1: PRE-FIX spec + the QA mutation -> must stay green (defect reproduced) ----
restore_all()
write(SPEC_REL, HEAD[SPEC_REL])  # pre-fix fixture: mockResolvedValue(<one Response>)
mutate(
    ERRORS_REL,
    "    documentationUrl: body?.documentationUrl,",
    f"    documentationUrl: body?.documentationUrl ?? 'Bearer {TOKEN}',",
)
results.append(run_spec("S1  PRE-FIX spec + M10 (token in documentationUrl fallback)", "pass"))

# --- S2: FIXED spec + the same QA mutation -> must fail ---------------------------
restore_all()
mutate(
    ERRORS_REL,
    "    documentationUrl: body?.documentationUrl,",
    f"    documentationUrl: body?.documentationUrl ?? 'Bearer {TOKEN}',",
)
results.append(run_spec("S2  FIXED spec + M10 (token in documentationUrl fallback)", "fail"))

# --- S3: FIXED spec + token appended to the envelope error message -> must fail ---
restore_all()
mutate(
    ERRORS_REL,
    "  return new ApiError({\n    message,\n    kind: 'http',",
    f"  return new ApiError({{\n    message: `${{message}} Bearer {TOKEN}`,\n    kind: 'http',",
)
results.append(run_spec("S3  FIXED spec + M13 (token in envelope error message)", "fail"))

# --- S4: FIXED spec + token in the GENERIC (non-envelope) branch -> must fail -----
restore_all()
mutate(
    CLIENT_REL,
    "      message: `Request failed with status ${response.status}`,",
    f"      message: `Request failed with status ${{response.status}} Bearer {TOKEN}`,",
)
results.append(run_spec("S4  FIXED spec + M12 (token in generic error branch)", "fail"))

# --- S5: FIXED spec, mutations reverted -> green again ---------------------------
restore_all()
results.append(run_spec("S5  fixed spec, mutations reverted", "pass"))

status = git("status", "--porcelain")
print("\n=== git status --porcelain after restore:", repr(status))
print("\n=== SUMMARY")
for r in results:
    print(f"  {'OK ' if r['ok'] else 'BAD'}  {r['label']}: {r['verdict']}")
# Only the uncommitted D1 fix to the spec may show up as modified.
expected_dirty = f" M {SPEC_REL}\n"
sys.exit(0 if all(r["ok"] for r in results) and status == expected_dirty else 1)
