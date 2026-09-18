#!/usr/bin/env node
/**
 * QA reviewer mutation probe for FE-001k (t_cdd23d35) — scratch, NOT the
 * implementer's harness. Independent mutations, deliberately different from
 * M1..M5, including a route-coverage probe the delivered harness does not have.
 *
 * Records, for each mutation, the lane exit code and the failing assertions, and
 * greps the assertion output for the axe rule id that fired. Every edit is
 * reverted in a finally block; the repo is verified to have no tracked diff at
 * the end.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = '/home/sap/qa-clones/rev-t_cdd23d35-105454'
const WEB = join(REPO, 'apps/web')

const ROUTES = 'apps/web/src/routes.tsx'
const SHELL = 'apps/web/src/components/layout/AppShell.tsx'
const SIDEBAR = 'apps/web/src/components/layout/Sidebar.tsx'
const INDEX = 'apps/web/index.html'

const MUTATIONS = [
  {
    id: 'Q1',
    describe: 'app: main landmark demoted to <div> (AppShell)',
    edits: [
      {
        file: SHELL,
        from: '<main id={MAIN_CONTENT_ID} tabIndex={-1} className="app-main">',
        to: '<div id={MAIN_CONTENT_ID} tabIndex={-1} className="app-main">',
      },
      {
        file: SHELL,
        from: '      </main>\n',
        to: '      </div>\n',
      },
    ],
  },
  {
    id: 'Q2',
    describe: 'document: index.html loses lang="en"',
    edits: [{ file: INDEX, from: '<html lang="en">', to: '<html>' }],
  },
  {
    id: 'Q3',
    describe: 'app: Sidebar nav gets an invalid ARIA attribute (aria-labeledby typo)',
    edits: [
      {
        file: SIDEBAR,
        from: 'aria-labelledby="app-sidebar__folders-heading"',
        to: 'aria-labelledby="app-sidebar__folders-heading" aria-labeledby="app-sidebar__folders-heading"',
      },
    ],
  },
  {
    id: 'Q4',
    describe: 'routes: a NEW route (/audit, no <h1>) added to the route table but not to the a11y ROUTES list',
    edits: [
      {
        file: ROUTES,
        from: "          { path: '/generator', element: <GeneratorPage /> },\n",
        to: "          { path: '/generator', element: <GeneratorPage /> },\n          { path: '/audit', element: <div>audit log</div> },\n",
      },
    ],
  },
]

const originals = new Map()

function apply(edits) {
  for (const { file, from, to } of edits) {
    const path = join(REPO, file)
    if (!originals.has(file)) originals.set(file, readFileSync(path, 'utf8'))
    const content = readFileSync(path, 'utf8')
    const n = content.split(from).length - 1
    if (n !== 1) throw new Error(`anchor matched ${n} times in ${file} (expected 1)`)
    writeFileSync(path, content.replace(from, to))
  }
}

function restoreAll() {
  for (const [file, content] of originals) writeFileSync(join(REPO, file), content)
  originals.clear()
}

function run(cmd, args, cwd) {
  try {
    return { code: 0, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '')
const lines = []
const say = (s) => { lines.push(s); process.stdout.write(`${s}\n`) }

say(`# QA reviewer probe — ${new Date().toISOString()}`)
say('')

let unexpected = 0

for (const m of MUTATIONS) {
  say(`## ${m.id} — ${m.describe}`)
  try {
    apply(m.edits)
    const a11y = run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.a11y.config.ts', '--reporter=verbose'], WEB)
    const out = strip(a11y.out)
    const tests = /Tests\s+(.+)$/m.exec(out)?.[1]?.trim() ?? 'n/a'
    say(`   a11y lane: exit ${a11y.code} — tests ${tests}`)
    const rules = [...new Set([...out.matchAll(/- \[[a-z]+\] ([a-z0-9-]+):/g)].map((x) => x[1]))]
    say(`   rule ids named in the failure output: ${rules.length ? rules.join(', ') : '(none)'}`)
    const fails = [...out.matchAll(/^\s*FAIL\s+(.+)$/gm)].map((x) => x[1].trim())
    say(`   failing assertions: ${fails.length}${fails.length ? ` — e.g. ${fails[0]}` : ''}`)
    if (/did not pass on/.test(out)) {
      const missing = [...new Set([...out.matchAll(/([a-z0-9-]+) did not pass on ([^\s]+)/g)].map((x) => `${x[1]} @ ${x[2]}`))]
      say(`   REQUIRED_PASSES misses: ${missing.slice(0, 4).join(' | ')}`)
    }
  } catch (e) {
    unexpected += 1
    say(`   ERROR: ${e.message}`)
  } finally {
    restoreAll()
  }
  say('')

  if (m.id === 'Q4') {
    // does anything else in the repo notice an unswept route?
    const unit = run('pnpm', ['test:unit'], REPO)
    const uout = strip(unit.out)
    const utests = /Tests\s+(.+)$/m.exec(uout)?.[1]?.trim() ?? 'n/a'
    say(`   unit lane with the same mutation: exit ${unit.code} — tests ${utests}`)
    const ufails = [...uout.matchAll(/FAIL\s+(.+)$/gm)].map((x) => x[1].trim())
    say(`   unit lane failures: ${ufails.length ? ufails.slice(0, 3).join(' | ') : '(none)'}`)
    say('')
  }
}

const clean = run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.a11y.config.ts'], WEB)
say(`## clean tree (control): exit ${clean.code} — tests ${/Tests\s+(.+)$/m.exec(strip(clean.out))?.[1]?.trim() ?? 'n/a'}`)

const diff = run('git', ['diff', '--stat'], REPO)
say(`## git diff --stat after all reverts: ${diff.out.trim() === '' ? '(empty — tree clean)' : diff.out}`)

writeFileSync('/home/sap/qa-clones/probe-t_cdd23d35-probe.txt', `${lines.join('\n')}\n`)
process.exit(unexpected === 0 ? 0 : 1)
