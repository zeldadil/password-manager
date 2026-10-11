// Vitest globalSetup: refuse to run the web test suite on an unsupported Node major
// (t_cf31ee46, root cause of t_a31f131d).
//
// `pnpm install` enforces `engines.node` (engine-strict in .npmrc), but `pnpm test` and
// `pnpm exec vitest` do not: they run on whichever `node` is first on PATH. Under Node 26,
// undici's `Request` rejects jsdom's `AbortSignal` on every react-router navigation and
// ~65 tests fail with "Expected signal ... to be an instance of AbortSignal". That is
// toolchain drift, not a product bug, so we stop before any test runs instead of
// producing misleading local evidence. Do NOT work around it by pinning
// globalThis.Request/AbortController in setupTests.ts — that would hide the drift and
// make local results differ from CI.
//
// Keep in sync with: root .nvmrc, `engines.node` in the root package.json and
// NODE_VERSION in .github/workflows/ci.yml (vitest.node-guard.test.ts checks .nvmrc).
export const EXPECTED_NODE_MAJOR = 22

/** Returns the error message for an unsupported Node version, or null if it is supported. */
export function nodeVersionError(version: string): string | null {
  const found = Number.parseInt(version.split('.')[0] ?? '', 10)
  if (found === EXPECTED_NODE_MAJOR) return null
  return [
    `Unsupported Node.js version for the apps/web tests: found Node ${found} (v${version}), expected Node ${EXPECTED_NODE_MAJOR}.x.`,
    `The repository pins Node ${EXPECTED_NODE_MAJOR} (.nvmrc, engines.node, CI NODE_VERSION). On another major the`,
    'suite fails for toolchain reasons (Node 26: "RequestInit: Expected signal (\\"AbortSignal {}\\") to be an',
    'instance of AbortSignal"), not because of the code under test.',
    `Fix: run the tests with Node ${EXPECTED_NODE_MAJOR} first on PATH, e.g.`,
    '  nvm use                      # reads .nvmrc',
    '  PATH=/usr/bin:$PATH pnpm test   # if /usr/bin/node is Node 22 (Hermes agent shells put Node 26 first)',
    'Check with: node --version',
  ].join('\n')
}

export default function setup(): void {
  const message = nodeVersionError(process.versions.node)
  if (message) throw new Error(message)
}
