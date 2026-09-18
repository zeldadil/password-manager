#!/usr/bin/env node
/** One-off QA probe: what catches the loss of the skip-link target id? */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = '/home/sap/qa-clones/rev-t_cdd23d35-105454'
const WEB = join(REPO, 'apps/web')
const SHELL = 'apps/web/src/components/layout/AppShell.tsx'

const path = join(REPO, SHELL)
const original = readFileSync(path, 'utf8')
const from = '<main id={MAIN_CONTENT_ID} tabIndex={-1} className="app-main">'
const to = '<main tabIndex={-1} className="app-main">'
if (original.split(from).length - 1 !== 1) throw new Error('anchor not unique')
writeFileSync(path, original.replace(from, to))

let out = ''
let code = 0
try {
  out = execFileSync('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.a11y.config.ts', '--reporter=verbose'], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (e) {
  code = e.status ?? 1
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`
} finally {
  writeFileSync(path, original)
}

const clean = out.replace(/\u001b\[[0-9;]*m/g, '')
const rules = [...new Set([...clean.matchAll(/- \[[a-z]+\] ([a-z0-9-]+):/g)].map((x) => x[1]))]
const misses = [...new Set([...clean.matchAll(/([a-z0-9-]+) did not pass on ([^\s]+)/g)].map((x) => `${x[1]} @ ${x[2]}`))]
const violations = [...new Set([...clean.matchAll(/✕|→/g)].map(() => ''))]
const diff = execFileSync('git', ['diff', '--stat'], { cwd: REPO, encoding: 'utf8' })

console.log(JSON.stringify({
  exit: code,
  tests: /Tests\s+(.+)$/m.exec(clean)?.[1]?.trim() ?? 'n/a',
  ruleIdsInFailures: rules,
  requiredPassesMisses: misses,
  distinctViolationNames: violations.length,
  treeCleanAfter: diff.trim() === '',
}, null, 2))
