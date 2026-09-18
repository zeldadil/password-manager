#!/usr/bin/env python3
"""Independent mutation checks for FE-001i (t_4e1b6937).

Each mutation breaks one behaviour the new spec claims to pin; the spec MUST then
fail. Everything is reverted via git restore after every mutation, and the tree is
verified clean at the end. Runs in the QA clone (pushed branch 9709272).
"""
import subprocess, sys, os

QA = "/home/sap/.hermes/kanban/workspaces/t_4e1b6937"
CLONE = f"{QA}/qa_clone"
WEB = f"{CLONE}/apps/web"
SRC = f"{WEB}/src"
ENV = dict(os.environ, PATH=f"{QA}/shim_qa:" + os.environ["PATH"])

MUTATIONS = [
    # (label, file, spec, old, new)
    ("M1 route guard: catch-all redirect pushes instead of replacing",
     f"{SRC}/routes.tsx", "src/routes.guards.test.tsx",
     """{ path: '*', element: <Navigate to="/login" replace /> },""",
     """{ path: '*', element: <Navigate to="/login" /> },"""),

    ("M2 route guard removed entirely (catch-all renders a screen)",
     f"{SRC}/routes.tsx", "src/routes.guards.test.tsx",
     """{ path: '*', element: <Navigate to="/login" replace /> },""",
     """{ path: '*', element: <div>guarded</div> },"""),

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

    ("M7 App: router replaced by a scaffold heading",
     f"{SRC}/App.tsx", "src/App.test.tsx",
     None, None),  # handled specially below

    ("M8 theme detector: hardcoded hex introduced into a component stylesheet",
     f"{SRC}/index.css", "src/theme.test.ts",
     "/* --- Accessibility baseline --- */",
     "/* --- Accessibility baseline --- */\n.bad-hex { color: #ff0000; }"),

    ("M9 theme detector: standalone colour keyword introduced",
     f"{SRC}/index.css", "src/theme.test.ts",
     "/* --- Accessibility baseline --- */",
     "/* --- Accessibility baseline --- */\n.bad-keyword { color: red; }"),
]

APP_ORIG = None


def run(cmd, cwd=WEB):
    p = subprocess.run(cmd, cwd=cwd, env=ENV, shell=True, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def spec_result(name):
    """Return (ok, summary-line) for a focused vitest run."""
    rc, out = run(f"corepack pnpm@9.12.0 exec vitest run {name} 2>&1")
    lines = [l.strip() for l in out.splitlines() if "Test Files" in l or "Tests " in l]
    return rc == 0, (" | ".join(lines) or "no summary")


def restore(paths):
    subprocess.run(["git", "restore", "--"] + paths, cwd=CLONE, check=True)


def main():
    global APP_ORIG
    with open(f"{SRC}/App.tsx") as fh:
        APP_ORIG = fh.read()

    fails = 0
    for label, path, spec, old, new in MUTATIONS:
        if path.endswith("App.tsx") and old is None:
            with open(path, "w") as fh:
                fh.write("export default function App() {\n  return <h1>Scaffold</h1>\n}\n")
        else:
            with open(path) as fh:
                text = fh.read()
            if old not in text:
                print(f"!! {label}: anchor not found -> CHECK MANUALLY")
                fails += 1
                continue
            with open(path, "w") as fh:
                fh.write(text.replace(old, new, 1))

        ok, summary = spec_result(spec)
        verdict = "FAILED (expected)" if not ok else "PASSED (!! spec is vacuous)"
        print(f"{'OK ' if not ok else 'BAD'} {label}\n      spec={spec}\n      -> {verdict}: {summary}")
        if ok:
            fails += 1
        restore([path])

    # sanity: tree clean and suite green again
    rc, out = run("git status --porcelain")
    print(f"\npost-mutation tree clean: {'YES' if not out.strip() else 'NO -> ' + out.strip()}")
    with open(f"{SRC}/App.tsx") as fh:
        print("App.tsx restored byte-identical:", fh.read() == APP_ORIG)
    ok, summary = spec_result("src")
    print(f"full suite after revert: {'green' if ok else 'RED'} ({summary})")
    print(f"\nmutation verdicts: {len(MUTATIONS) - fails}/{len(MUTATIONS)} specs failed as expected")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
