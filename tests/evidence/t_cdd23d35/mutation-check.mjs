#!/usr/bin/env node
/**
 * FE-001k mutation harness — proves the axe-core sweep in
 * `apps/web/src/a11y/routes.a11y.test.tsx` is a real sensor.
 *
 * The deliverable of FE-001k is a *check*. A check that reports "zero violations"
 * is only meaningful if it can report violations, so this harness breaks the thing
 * under test in five ways and records whether the lane notices:
 *
 *   M1  harness: the jsdom hit-test stub is disabled      -> must FAIL (rules skipped)
 *   M2  app: the /vault h1 is not a heading               -> must FAIL
 *   M3  app: the skip-link target id is dropped           -> must FAIL
 *   M4  app: the sidebar loses its accessible name        -> must FAIL
 *   M5  M1 + the sweep's `incomplete` assertion removed   -> must PASS
 *       (the "vacuous green" control: with the stub disabled and the incomplete
 *       check dropped, the sweep goes green over a page where two page-level rules
 *       were never evaluated — i.e. it reproduces the defect the check exists for)
 *
 * Every edit is reverted before the next mutation and at the end (also on error),
 * so the tree is left clean. Run from the repository root:
 *
 *   node tests/evidence/t_cdd23d35/mutation-check.mjs
 *
 * Exit code 0 = every mutation behaved as expected.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const WEB = join(REPO, 'apps/web')

const AXE = 'apps/web/src/a11y/axe.ts'
const ROUTES_SPEC = 'apps/web/src/a11y/routes.a11y.test.tsx'
const VAULT_PAGE = 'apps/web/src/pages/VaultPage.tsx'
const APP_SHELL = 'apps/web/src/components/layout/AppShell.tsx'
const SIDEBAR = 'apps/web/src/components/layout/Sidebar.tsx'

const edit = (file, from, to) => ({ file, from, to })

const MUTATIONS = [
  {
    id: 'M1',
    describe: 'harness: jsdom hit-test stub disabled (page-level rules get skipped)',
    expected: 'fail',
    edits: [
      edit(
        AXE,
        "  if (typeof document.elementFromPoint !== 'function') {\n    document.elementFromPoint = () => null\n  }",
        '  // mutation M1: stub disabled',
      ),
    ],
  },
  {
    id: 'M2',
    describe: 'app: the /vault screen has no <h1>',
    expected: 'fail',
    edits: [edit(VAULT_PAGE, '<h1>Vault</h1>', '<div>Vault</div>')],
  },
  {
    id: 'M3',
    describe: 'app: the skip link points at a landmark that has no id',
    expected: 'fail',
    edits: [edit(APP_SHELL, '<main id={MAIN_CONTENT_ID} tabIndex={-1} className="app-main">', '<main tabIndex={-1} className="app-main">')],
  },
  {
    id: 'M4',
    describe: 'app: the sidebar\'s two <nav> landmarks get the same accessible name',
    expected: 'fail',
    edits: [
      edit(
        SIDEBAR,
        'aria-labelledby="app-sidebar__tags-heading"',
        'aria-labelledby="app-sidebar__folders-heading"',
      ),
    ],
  },
  {
    id: 'M5',
    describe:
      'M1 + sweep reduced to a violations-only check (no `incomplete` assertion, no vacuity guard, sensitivity block skipped) — vacuous-green control',
    expected: 'pass',
    edits: [
      edit(
        AXE,
        "  if (typeof document.elementFromPoint !== 'function') {\n    document.elementFromPoint = () => null\n  }",
        '  // mutation M1: stub disabled',
      ),
      edit(
        ROUTES_SPEC,
        `    // Formatted so a failure names the rule, the impact and the offending node.
    expect(formatViolations(results)).toBe('')
    expect(results.violations).toEqual([])

    // "axe could not decide" is not a pass.
    expect(results.incomplete.map((result) => result.id)).toEqual([])

    // Vacuity guard: the sweep graded a real rule set, including the rules that
    // define this app's page structure.
    const graded = results.passes.map((result) => result.id)
    expect(graded.length).toBeGreaterThanOrEqual(MIN_GRADED_RULES)
    for (const rule of REQUIRED_PASSES) {
      expect(graded, \`\${rule} did not pass on \${path}\`).toContain(rule)
    }`,
        `    // mutation M5: sweep reduced to a violations-only check (the "before" state)
    expect(formatViolations(results)).toBe('')`,
      ),
      edit(
        ROUTES_SPEC,
        '    expect(results.incomplete.map((result) => result.id)).toEqual([])',
        '    // mutation M5: incomplete assertion removed',
      ),
      edit(
        ROUTES_SPEC,
        "describe('axe-core harness — the sweep can actually fail'",
        "describe.skip('axe-core harness — the sweep can actually fail'",
      ),
    ],
  },
]

const originals = new Map()
function restoreAll() {
  for (const [file, content] of originals) {
    writeFileSync(join(REPO, file), content)
    process.stdout.write(`  restored ${file}\n`)
  }
  originals.clear()
}

function apply(edits) {
  for (const { file, from, to } of edits) {
    const path = join(REPO, file)
    if (!originals.has(file)) originals.set(file, readFileSync(path, 'utf8'))
    const content = readFileSync(path, 'utf8')
    const occurrences = content.split(from).length - 1
    if (occurrences !== 1) {
      throw new Error(`mutation anchor matched ${occurrences} times in ${file} (expected 1)`)
    }
    writeFileSync(path, content.replace(from, to))
  }
}

function runLane() {
  try {
    const stdout = execFileSync('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.a11y.config.ts'], {
      cwd: WEB,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { exitCode: 0, output: stdout }
  } catch (error) {
    return { exitCode: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

function summarise(output) {
  const failedTests = [...output.matchAll(/^\s*FAIL\s+(.+)$/gm)].map((match) => match[1].trim())
  const counts = /Tests\s+(.+)$/m.exec(output.replace(/\u001b\[[0-9;]*m/g, ''))
  return { failedTests, counts: counts ? counts[1].trim() : 'n/a' }
}

const lines = []
const record = (line) => {
  lines.push(line)
  process.stdout.write(`${line}\n`)
}

record(`# FE-001k mutation checks — ${new Date().toISOString()}`)
record(`# lane: pnpm exec vitest run --config vitest.a11y.config.ts (apps/web)`)
record('')

let failures = 0

for (const mutation of MUTATIONS) {
  record(`## ${mutation.id} — ${mutation.describe}`)
  record(`   expected: ${mutation.expected}`)
  try {
    apply(mutation.edits)
    const { exitCode, output } = runLane()
    const outcome = exitCode === 0 ? 'pass' : 'fail'
    const { failedTests, counts } = summarise(output)
    record(`   observed: ${outcome} (exit ${exitCode}, tests ${counts})`)
    if (failedTests.length) {
      record(`   failing:  ${failedTests.slice(0, 4).join(' | ')}${failedTests.length > 4 ? ` …(+${failedTests.length - 4})` : ''}`)
    }
    if (outcome !== mutation.expected) {
      failures += 1
      record('   RESULT:   UNEXPECTED')
    } else {
      record('   RESULT:   as expected')
    }
  } catch (error) {
    failures += 1
    record(`   ERROR:    ${error.message}`)
  } finally {
    restoreAll()
  }
  record('')
}

const clean = runLane()
record(`## clean tree (control)`)
record(`   observed: ${clean.exitCode === 0 ? 'pass' : 'fail'} (exit ${clean.exitCode}, tests ${summarise(clean.output).counts})`)
record(`   RESULT:   ${clean.exitCode === 0 ? 'as expected' : 'UNEXPECTED'}`)
if (clean.exitCode !== 0) failures += 1

writeFileSync(join(HERE, 'mutations.txt'), `${lines.join('\n')}\n`)
record('')
record(failures === 0 ? 'ALL MUTATIONS BEHAVED AS EXPECTED' : `${failures} UNEXPECTED RESULT(S)`)
process.exit(failures === 0 ? 0 : 1)
