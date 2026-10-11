// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import setup, { EXPECTED_NODE_MAJOR, nodeVersionError } from './vitest.node-guard.ts'

// t_cf31ee46: the web test suite must fail fast on a Node major other than the
// pinned one. Under Node 26, 65 tests fail with undici's "Expected signal ... to be
// an instance of AbortSignal" — a toolchain mismatch, not a product bug.
describe('vitest Node guard', () => {
  it('pins the same major as the root .nvmrc', () => {
    const nvmrc = readFileSync(fileURLToPath(new URL('../../.nvmrc', import.meta.url)), 'utf8')
    expect(String(EXPECTED_NODE_MAJOR)).toBe(nvmrc.trim())
  })

  it('accepts any version of the expected major', () => {
    expect(nodeVersionError(`${EXPECTED_NODE_MAJOR}.0.0`)).toBeNull()
    expect(nodeVersionError(`${EXPECTED_NODE_MAJOR}.23.3`)).toBeNull()
  })

  it.each(['26.7.0', '24.1.0', '20.18.0', '23.0.0'])('rejects Node %s', (version) => {
    const message = nodeVersionError(version)
    expect(message).not.toBeNull()
    const found = version.split('.')[0]
    expect(message).toContain(`found Node ${found} (v${version})`)
    expect(message).toContain(`expected Node ${EXPECTED_NODE_MAJOR}`)
    expect(message).toContain('PATH=/usr/bin:$PATH')
    expect(message).toContain('nvm use')
    expect(message).toContain('Expected signal')
  })

  it('globalSetup passes on the running Node (the suite only gets here on the pinned major)', () => {
    expect(() => setup()).not.toThrow()
  })
})
