#!/usr/bin/env node
/**
 * FE-001k-fu (t_782802ac) mutation harness — proves the route-coverage link between
 * the a11y sweep and the route table is a real sensor, and pins the measured facts the
 * card's Finding 2 wording has to match.
 *
 * The defect this card closes: `apps/web/src/a11y/routes.a11y.test.tsx` graded a
 * hand-written `ROUTES` list, and nothing tied that list to `apps/web/src/routes.tsx`.
 * A route added to the table was therefore graded by nobody ("all routes" meant "the
 * routes someone remembered to list") and both lanes stayed green (QA probe Q4).
 *
 *   R1  app: a NEW route `/audit` (no <h1>) is added to the route table and NOT to the
 *       sweep                                                        -> must FAIL (Q4)
 *   R2  lane: the sweep drops its `/generator` case while the table still declares
 *       `/generator`                                                 -> must FAIL
 *   R3  app+lane: the same `/audit` route added to the table AND to the sweep (rendering
 *       an existing compliant screen)                                -> must PASS
 *   R4  control: R1 + the coverage block skipped — i.e. exactly the pre-fix lane, which
 *       had no such block                                            -> must PASS (the
 *       vacuous green this card exists for; the new specs are what turn R1 red)
 *
 *   P1  probe: the skip link is removed from `A11yLayout` -> must FAIL on the four
 *       pre-auth resolutions (`bypass` has nothing else to satisfy it there), while the
 *       six shell routes stay green (header/landmarks satisfy `bypass`) — i.e. the
 *       sweep does catch a missing skip link, but only where nothing else bypasses
 *   P2  probe: the skip-link target id is dropped from `<main>` -> must FAIL, and the
 *       rule id that fires is recorded (Finding 2.3 wording: it is `region`, not
 *       `bypass`)
 *
 * Every edit is reverted in a `finally` block, and the working tree is verified clean
 * against git at the end. Run from anywhere inside the repo:
 *
 *   node tests/evidence/t_782802ac/mutation-check.mjs
 *
 * Exit 0 = every mutation behaved as expected and the tree was left clean.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const WEB = join(REPO, 'apps/web')

const ROUTES_TABLE = 'apps/web/src/routes.tsx'
const ROUTES_SPEC = 'apps/web/src/a11y/routes.a11y.test.tsx'
const A11Y_LAYOUT = 'apps/web/src/a11y/A11yLayout.tsx'
const APP_SHELL = 'apps/web/src/components/layout/AppShell.tsx'

const COVERAGE_DESCRIBE = "describe('route coverage — the sweep is tied to the route table', () => {"
const COVERAGE_DESCRIBE_SKIPPED =
  "describe.skip('route coverage — the sweep is tied to the route table', () => {"
const GENERATOR_ROUTE = "          { path: '/generator', element: <GeneratorPage /> },\n"
const GENERATOR_CASE = "  { path: '/generator', screen: 'Password generator', resolved: '/generator' },\n"
const SKIP_LINK = '      <SkipLink />\n'
const MAIN_WITH_ID = '      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="app-main">'

const edit = (file, from, to) => ({ file, from, to })

const UNSWEPT_ROUTE = edit(
  ROUTES_TABLE,
  GENERATOR_ROUTE,
  `${GENERATOR_ROUTE}          { path: '/audit', element: <div>audit log</div> },\n`,
)
const SWEPT_AUDIT_ROUTE = edit(
  ROUTES_TABLE,
  GENERATOR_ROUTE,
  `${GENERATOR_ROUTE}          { path: '/audit', element: <VaultPage /> },\n`,
)
const AUDIT_CASE = edit(
  ROUTES_SPEC,
  GENERATOR_CASE,
  `${GENERATOR_CASE}  { path: '/audit', screen: 'Audit (positive control)', resolved: '/audit' },\n`,
)
const GHOST_CASE = edit(
  ROUTES_SPEC,
  GENERATOR_CASE,
  `${GENERATOR_CASE}  { path: '/ghost', screen: 'ghost (a path no route declares)', resolved: '/login' },\n`,
)

const MUTATIONS = [
  {
    id: 'R1',
    scope: 'app',
    describe:
      'a NEW route `/audit` (no <h1>) added to the route table and NOT to the sweep — QA probe Q4',
    expected: 'fail',
    edits: [UNSWEPT_ROUTE],
  },
  {
    id: 'R2',
    scope: 'lane',
    describe: "the sweep drops its `/generator` case while the route table still declares `/generator`",
    expected: 'fail',
    edits: [edit(ROUTES_SPEC, GENERATOR_CASE, '')],
  },
  {
    id: 'R3',
    scope: 'app+lane',
    describe:
      'the same `/audit` route added to the route table AND to the sweep (rendering the existing, compliant VaultPage)',
    expected: 'pass',
    edits: [SWEPT_AUDIT_ROUTE, AUDIT_CASE],
  },
  {
    id: 'R4',
    scope: 'control',
    describe:
      'R1 + the coverage block skipped — exactly the pre-fix lane, which had no coverage block',
    expected: 'pass',
    edits: [UNSWEPT_ROUTE, edit(ROUTES_SPEC, COVERAGE_DESCRIBE, COVERAGE_DESCRIBE_SKIPPED)],
  },
  {
    id: 'R5',
    scope: 'lane',
    describe:
      'a stray swept case `/ghost` added to ROUTES that the route table does not declare (not via any concrete pattern, and not marked `isSplatWitness`) — the fix for the review-round-1 defect: the converse spec previously could not fail because every path trivially matches the declared `*` catch-all pattern',
    expected: 'fail',
    edits: [GHOST_CASE],
  },
  {
    id: 'P1',
    scope: 'probe',
    describe:
      'the skip link is removed from `A11yLayout` — fails on the four pre-auth resolutions (nothing else satisfies `bypass` there), green on the six shell routes (header/landmarks satisfy it)',
    expected: 'fail',
    edits: [edit(A11Y_LAYOUT, SKIP_LINK, '')],
  },
  {
    id: 'P2',
    scope: 'probe',
    describe: 'the skip-link target id is dropped from `<main>` in `AppShell`',
    expected: 'fail',
    edits: [edit(APP_SHELL, MAIN_WITH_ID, '      <main tabIndex={-1} className="app-main">')],
  },
]

const originals = new Map()

/** Blob hashes of every file a mutation touches — compared before/after the run so a
 * leaked edit is detected regardless of what else is in the working tree. */
const MUTATED_FILES = [ROUTES_TABLE, ROUTES_SPEC, A11Y_LAYOUT, APP_SHELL]
function targetHashes() {
  return execFileSync('git', ['hash-object', '--', ...MUTATED_FILES], { cwd: REPO, encoding: 'utf8' }).trim()
}

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
    // The literal command the acceptance criteria name (`package.json` → `vitest run
    // --config vitest.a11y.config.ts`), not a re-spelled equivalent.
    const stdout = execFileSync('pnpm', ['test:a11y'], {
      cwd: WEB,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { exitCode: 0, output: stdout }
  } catch (error) {
    return { exitCode: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

function summarise(output) {
  const plain = stripAnsi(output)
  const failedTests = [...plain.matchAll(/^\s*FAIL\s+(.+)$/gm)].map((match) => match[1].trim())
  const counts = /Tests\s+(.+)$/m.exec(plain)
  // `formatViolations()` lines: "- [serious] region: All page content should be … — html"
  const rules = [...new Set([...plain.matchAll(/- \[[a-z]+\] ([a-z0-9-]+):/g)].map((match) => match[1]))]
  const coverageMessages = [
    ...new Set(
      [
        ...plain.matchAll(
          /(route table declares screen paths this sweep does not grade: [^\n]*)/g,
        ),
        ...plain.matchAll(/(swept paths the route table does not declare: [^\n]*)/g),
      ]
        .map((match) => match[1].trim())
        // The stack frame echoes the template literal itself; keep only the real message.
        .filter((message) => !message.includes('${')),
    ),
  ]
  // The vacuity guard's own message: "<rule> did not pass on <path>" (REQUIRED_PASSES).
  const missingPasses = [
    ...new Set([...plain.matchAll(/([a-z0-9-]+) did not pass on ([^\s:]+)/g)].map((m) => `${m[1]} on ${m[2]}`)),
  ]
  return {
    failedTests,
    counts: counts ? counts[1].trim() : 'n/a',
    rules,
    coverageMessages: [...new Set(coverageMessages)],
    missingPasses,
  }
}

const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length)
const FULL_OUTPUT = process.argv.includes('--full')

const lines = []
const record = (line) => {
  lines.push(line)
  process.stdout.write(`${line}\n`)
}

record(`# FE-001k-fu (t_782802ac) mutation checks — ${new Date().toISOString()}`)
record('# lane: pnpm test:a11y (apps/web) — the acceptance-criteria command')
record(`# mode: ${only ? `--only=${only}` : 'all mutations'}${FULL_OUTPUT ? ' --full' : ''}`)
const hashesBefore = targetHashes()
record(`# files under mutation: ${MUTATED_FILES.join(', ')} (blob hashes recorded before the run)`)
record('')

let failures = 0

for (const mutation of MUTATIONS) {
  if (only && mutation.id !== only) continue
  record(`## ${mutation.id} — [${mutation.scope}] ${mutation.describe}`)
  record(`   expected: ${mutation.expected}`)
  try {
    apply(mutation.edits)
    const { exitCode, output } = runLane()
    if (FULL_OUTPUT) record(stripAnsi(output))
    const outcome = exitCode === 0 ? 'pass' : 'fail'
    const { failedTests, counts, rules, coverageMessages, missingPasses } = summarise(output)
    record(`   observed: ${outcome} (exit ${exitCode}, tests ${counts})`)
    if (failedTests.length) {
      record(
        `   failing:  ${failedTests.slice(0, 3).join(' | ')}${failedTests.length > 3 ? ` …(+${failedTests.length - 3})` : ''}`,
      )
    }
    for (const message of coverageMessages) record(`   coverage: ${message}`)
    if (missingPasses.length) record(`   required-pass failures: ${missingPasses.join(', ')}`)
    if (rules.length) record(`   rule ids named in failures: ${rules.join(', ')}`)
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

if (only) {
  record(`${failures === 0 ? 'OK' : `${failures} UNEXPECTED RESULT(S)`} (--only mode: mutations.txt not rewritten)`)
  process.exit(failures === 0 ? 0 : 1)
}

const clean = runLane()
record('## clean tree (control)')
record(
  `   observed: ${clean.exitCode === 0 ? 'pass' : 'fail'} (exit ${clean.exitCode}, tests ${summarise(clean.output).counts})`,
)
record(`   RESULT:   ${clean.exitCode === 0 ? 'as expected' : 'UNEXPECTED'}`)
if (clean.exitCode !== 0) failures += 1
record('')

const hashesAfter = targetHashes()
const restored = hashesBefore === hashesAfter
record('## revert check — every mutated file back to its pre-run content')
record(`   blob hashes ${restored ? 'identical' : 'DIFFERENT'} before/after the run`)
record(`   RESULT:   ${restored ? 'as expected' : 'UNEXPECTED — a mutation leaked'}`)
if (!restored) {
  failures += 1
  for (const file of MUTATED_FILES) {
    record(
      `   git diff --stat ${file}: ${execFileSync('git', ['diff', '--stat', '--', file], { cwd: REPO, encoding: 'utf8' }).trim() || '(unchanged vs HEAD)'}`,
    )
  }
}

writeFileSync(join(HERE, 'mutations.txt'), `${lines.join('\n')}\n`)
record('')
record(failures === 0 ? 'ALL MUTATIONS BEHAVED AS EXPECTED' : `${failures} UNEXPECTED RESULT(S)`)
process.exit(failures === 0 ? 0 : 1)
