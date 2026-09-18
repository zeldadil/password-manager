#!/usr/bin/env python3
"""Round-2 regression sweep: re-run the round-1 mutation set against the round-2 head.

Context: the only source change between the reviewed round-1 head (9709272) and the
round-2 head (823d7ab) is `apps/web/src/api/envelope.test.ts`, so this sweep exists to
show the *other* specs are unchanged in behaviour (each still fails when the behaviour
it pins is broken). Runs on the fresh round-2 clone qa_r2/pm; every mutation is reverted
with `git restore` and the tree is verified clean at the end.
"""
import os
import subprocess
import sys

QA = "/home/sap/.hermes/kanban/workspaces/t_4e1b6937/qa_r2"
CLONE = f"{QA}/pm"
WEB = f"{CLONE}/apps/web"
SRC = f"{WEB}/src"
ENV = dict(os.environ, PATH=f"{QA}/shim:" + os.environ["PATH"])

MUTATIONS = [
    ("M1 route guard: catch-all redirect pushes instead of replacing",
     f"{SRC}/routes.tsx", "src/routes.guards.test.tsx",
     """{ path: '*', element: <Navigate to="/login" replace /> },""",
     """{ path: '*', element: <Navigate to="/login" /> },"""),
    ("M3 API client: envelope code>=400 branch dropped",
     f"{SRC}/api/client.ts", "src/api/envelope.test.ts",
     "const isError = header.status === 'error' || header.code >= 400",
     "const isError = header.status === 'error'"),
    ("M4 API client: base URL trailing-slash normalization dropped",
     f"{SRC}/api/client.ts", "src/api/envelope.test.ts",
     "this.baseUrl = options.baseUrl.replace(/\\/+$/, '')",
     "this.baseUrl = options.baseUrl"),
    ("M5 theme store: toggle flattened to always 'light'",
     f"{SRC}/stores/themeStore.ts", "src/stores/themeToggle.test.ts",
     "toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),",
     "toggleTheme: () => set({ theme: 'light' }),"),
    ("M6 header: aria-controls always set even when collapsed",
     f"{SRC}/components/layout/Header.tsx", "src/components/layout/layout.contract.test.tsx",
     "aria-controls={menuOpen ? 'user-menu' : undefined}",
     "aria-controls=\"user-menu\""),
    ("M8 theme detector: hardcoded hex introduced into a component stylesheet",
     f"{SRC}/index.css", "src/theme.test.ts",
     "/* --- Accessibility baseline --- */",
     "/* --- Accessibility baseline --- */\n.bad-hex { color: #ff0000; }"),
    ("M9 theme detector: standalone colour keyword introduced",
     f"{SRC}/index.css", "src/theme.test.ts",
     "/* --- Accessibility baseline --- */",
     "/* --- Accessibility baseline --- */\n.bad-keyword { color: red; }"),
    ("M11 SEC-001 sensor: theme toggle starts persisting to localStorage",
     f"{SRC}/stores/themeStore.ts", "src/stores/themeToggle.test.ts",
     "toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),",
     "toggleTheme: () =>\n    set((state) => {\n      const next = state.theme === 'dark' ? 'light' : 'dark'\n      localStorage.setItem('theme', next)\n      return { theme: next }\n    }),"),
]


def run(cmd):
    p = subprocess.run(cmd, cwd=WEB, env=ENV, shell=True, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def spec_result(name):
    rc, out = run(f"pnpm exec vitest run {name} 2>&1")
    lines = [l.strip() for l in out.splitlines() if "Test Files" in l or "Tests " in l]
    return rc == 0, (" | ".join(lines) or "no summary")


def restore(paths):
    subprocess.run(["git", "restore", "--"] + paths, cwd=CLONE, check=True)


fails = 0
for label, path, spec, old, new in MUTATIONS:
    with open(path) as fh:
        text = fh.read()
    if old not in text:
        print(f"!! {label}: anchor not found -> CHECK MANUALLY")
        fails += 1
        continue
    with open(path, "w") as fh:
        fh.write(text.replace(old, new, 1))
    ok, summary = spec_result(spec)
    print(f"{'OK ' if not ok else 'BAD'} {label}\n      spec={spec}\n"
          f"      -> {'FAILED (expected)' if not ok else 'PASSED (!! spec is vacuous)'}: {summary}")
    if ok:
        fails += 1
    restore([path])

rc, out = run("git status --porcelain")
print(f"\npost-mutation tree clean: {'YES' if not out.strip() else 'NO -> ' + out.strip()}")
ok, summary = spec_result("src")
print(f"full suite after revert: {'green' if ok else 'RED'} ({summary})")
print(f"\nregression verdicts: {len(MUTATIONS) - fails}/{len(MUTATIONS)} specs failed as expected")
sys.exit(1 if fails or out.strip() else 0)
