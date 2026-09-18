#!/usr/bin/env python3
"""Two extra sensitivity checks on the new specs' non-behavioural assertions.

M10: does the "bearer token never echoes into the error" assertion actually see
     the error's enumerable fields? (JSON.stringify(Error) is '{}' unless the
     subclass assigns own enumerable props -- ApiError does, but that has to be
     proven, not assumed.)
M11: does the SEC-001 "in-memory only" assertion actually fail when the theme
     store starts persisting to localStorage?
"""
import subprocess, os, sys

QA = "/home/sap/.hermes/kanban/workspaces/t_4e1b6937"
CLONE = f"{QA}/qa_clone"
WEB = f"{CLONE}/apps/web"
SRC = f"{WEB}/src"
ENV = dict(os.environ, PATH=f"{QA}/shim_qa:" + os.environ["PATH"])

CASES = [
    ("M10 error leak sensor: token injected into an enumerable ApiError field",
     f"{SRC}/api/errors.ts", "src/api/envelope.test.ts",
     "documentationUrl: body?.documentationUrl,",
     "documentationUrl: body?.documentationUrl ?? 'Bearer super-secret-jwt',"),
    ("M11 SEC-001 sensor: theme toggle starts persisting to localStorage",
     f"{SRC}/stores/themeStore.ts", "src/stores/themeToggle.test.ts",
     "toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),",
     "toggleTheme: () =>\n    set((state) => {\n      const next = state.theme === 'dark' ? 'light' : 'dark'\n      localStorage.setItem('theme', next)\n      return { theme: next }\n    }),"),
]


def run(cmd):
    p = subprocess.run(cmd, cwd=WEB, env=ENV, shell=True, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def summarise(spec):
    rc, out = run(f"corepack pnpm@9.12.0 exec vitest run {spec} 2>&1")
    lines = [l.strip() for l in out.splitlines() if "Test Files" in l or "Tests " in l]
    return rc, " | ".join(lines)


bad = 0
for label, path, spec, old, new in CASES:
    with open(path) as fh:
        text = fh.read()
    if old not in text:
        print(f"!! anchor not found: {label}")
        bad += 1
        continue
    with open(path, "w") as fh:
        fh.write(text.replace(old, new, 1))
    rc, summary = summarise(spec); ok = rc == 0
    print(f"{'OK ' if not ok else 'BAD'} {label}\n      spec={spec}\n      -> {'FAILED (sensitive)' if not ok else 'PASSED (!! assertion is blind)'}: {summary}")
    if ok:
        bad += 1
    subprocess.run(["git", "restore", "--", path], cwd=CLONE, check=True)

rc, out = run("git status --porcelain")
print("tree clean after revert:", "YES" if not out.strip() else "NO " + out.strip())
sys.exit(1 if bad else 0)
