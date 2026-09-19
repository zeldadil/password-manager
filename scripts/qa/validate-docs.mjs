#!/usr/bin/env node
/**
 * scripts/qa/validate-docs.mjs — document validator for the Secure Password Manager repo.
 *
 * Purpose (TEST_STRATEGY.md §14, test type `doc-validation`):
 *   A QA verdict for a documentation card must be backed by a mechanical check, not prose.
 *   This script validates one or more markdown documents against the strategy's requirements.
 *
 * Checks
 *   1. completeness  — every topic required by the card is present in the document
 *   2. references    — every concrete repo file referenced exists; planned layout paths are reported, not failed
 *   3. board-alignment — the doc's test-type vocabulary covers every `Test Types:` label used in backlog.md
 *   4. policy-hygiene  — no real-looking secret material, non-reserved domains, or PII in the doc itself
 *   5. traceability  — SEC-001 absolute rules AR-1..AR-6 are each referenced
 *
 * Usage
 *   node scripts/qa/validate-docs.mjs TEST_STRATEGY.md [more.md ...]
 *   node scripts/qa/validate-docs.mjs            # defaults to TEST_STRATEGY.md
 *
 * Exit codes: 0 = all checks passed (warnings allowed), 1 = at least one hard error.
 *
 * Hygiene skip rule: a line containing one of FORBIDDEN_HINTS is treated as documentation *about* an anti-pattern
 * (e.g. the "Forbidden" table in TEST_STRATEGY.md §7) and is exempt from domain/PII matching. Secret-shaped
 * material (keys, tokens) is never exempt.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// ---------------------------------------------------------------- required topics (check 1)
// slug -> [regex alternatives that satisfy the topic]
const REQUIRED_TOPICS = {
  'unit tests': [/\bunit\b/i],
  'integration tests': [/\bintegration\b/i],
  'security tests': [/\bsecurity\b/i],
  'e2e tests': [/\bend-to-end\b|\bE2E\b/],
  'exploratory tests': [/\bexploratory\b/i],
  'regression tests': [/\bregression\b/i],
  'tools': [/\btools?\b/i],
  'coverage targets': [/\bcoverage\b[\s\S]{0,40}\btarget/i, /\btarget[s]?\b[\s\S]{0,40}\bcoverage\b/i, /coverage\s+targets/i],
  'negative test requirements': [/negative\s+test/i],
  'synthetic data policy': [/synthetic\s+data/i],
};

// ---------------------------------------------------------------- path reference patterns (check 2)
const PATH_PATTERNS = [
  /`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.*-]+)+)`/g, // backticked paths
  /`([A-Z][A-Za-z0-9_.-]*\.(?:md|json|ya?ml|ts|tsx))`/g, // backticked file names
];
// Files that must exist for the document's claims to hold.
const MUST_EXIST_SUFFIXES = ['.md', '.yaml', '.yml', '.json', '.mjs', '.cjs'];
const MUST_EXIST_ROOTS = ['architecture/', 'scripts/', 'docs/'];
// Target-layout prefixes defined by ADR-002 but not yet committed: reported as planned paths.
const PLANNED_PREFIXES = ['tests/', 'apps/', 'packages/', '.github/'];

// ---------------------------------------------------------------- hygiene (check 4)
const SECRET_SHAPES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'GitHub PAT'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bsk-[A-Za-z0-9]{20,}\b/, 'OpenAI-style API key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'JWT'],
  [/\b(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*["'][^"']{12,}["']/i, 'inline credential assignment'],
];
const RESERVED_TLDS = ['.test', '.invalid', '.example', '.localhost', 'localhost'];
const DOMAIN_RE = /\bhttps?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b|\b([A-Za-z0-9-]+\.(?:com|net|org))\b/g;
const ALLOWED_DOC_DOMAINS = new Set([
  'github.com', 'githubusercontent.com', 'owasp.org', 'nist.gov', 'rfc-editor.org', 'ietf.org',
  'mozilla.org', 'npmjs.com', 'nodejs.org', 'typescriptlang.org', 'playwright.dev', 'vitest.dev',
  'stackoverflow.com', 'w3.org',
]);
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const FORBIDDEN_HINTS = /forbidden|never use|not allowed|anti-pattern|must not|do not use/i;

// ---------------------------------------------------------------- traceability (check 5)
const REQUIRED_RULES = ['AR-1', 'AR-2', 'AR-3', 'AR-4', 'AR-5', 'AR-6'];

// ---------------------------------------------------------------- helpers
const errors = [];
const warnings = [];
const info = [];

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

// Basenames of every file tracked by git, so a document may cite "ADR-004-api-contract.yaml"
// without the full path and still have the reference verified.
let TRACKED_BASENAMES = null;
function trackedBasenames() {
  if (TRACKED_BASENAMES) return TRACKED_BASENAMES;
  TRACKED_BASENAMES = new Set();
  try {
    const out = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    for (const line of out.split('\n')) {
      const base = path.basename(line.trim());
      if (base) TRACKED_BASENAMES.add(base);
    }
  } catch {
    /* not a git repo — fall back to path-only checks */
  }
  return TRACKED_BASENAMES;
}

function isPlanned(p) {
  return PLANNED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function looksLikePath(token) {
  if (token.includes('*')) return false; // globs are described, not asserted
  if (/^https?:/.test(token)) return false;
  if (token.startsWith('node:')) return false;
  return /\.[A-Za-z0-9]{1,5}$/.test(token) || token.includes('/');
}

function extractPaths(text) {
  const found = new Set();
  for (const re of PATH_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const token = match[1].trim();
      if (looksLikePath(token)) found.add(token);
    }
  }
  return found;
}

function checkCompleteness(name, text) {
  const missing = [];
  for (const [topic, regexes] of Object.entries(REQUIRED_TOPICS)) {
    if (!regexes.some((re) => re.test(text))) missing.push(topic);
  }
  if (missing.length) errors.push(`[${name}] completeness: missing required topic(s): ${missing.join(', ')}`);
  else info.push(`[${name}] completeness: all ${Object.keys(REQUIRED_TOPICS).length} required topics present`);
}

function checkReferences(name, text, root) {
  const refs = extractPaths(text);
  const missingHard = [];
  const planned = [];
  const ok = [];
  for (const ref of [...refs].sort()) {
    const abs = path.join(root, ref);
    if (existsSync(abs)) ok.push(ref);
    else if (!ref.includes('/') && trackedBasenames().has(ref)) ok.push(ref);
    else if (isPlanned(ref)) planned.push(ref);
    else if (MUST_EXIST_ROOTS.some((r) => ref.startsWith(r)) || MUST_EXIST_SUFFIXES.some((s) => ref.endsWith(s))) {
      missingHard.push(ref);
    } else planned.push(ref);
  }
  if (missingHard.length) errors.push(`[${name}] references: referenced file(s) do not exist: ${missingHard.join(', ')}`);
  info.push(`[${name}] references: ${ok.length} existing path(s) verified`);
  if (planned.length) {
    info.push(`[${name}] references: ${planned.length} planned/not-yet-created path(s) (ADR-002 target layout, not a failure): ${planned.join(', ')}`);
  }
}

function checkBoardAlignment(name, text, root) {
  const backlog = path.join(root, 'architecture/kanban/backlog.md');
  if (!existsSync(backlog)) {
    warnings.push(`[${name}] board-alignment: architecture/kanban/backlog.md not found — check skipped`);
    return;
  }
  const boardTypes = new Set();
  for (const line of readFileSync(backlog, 'utf8').split('\n')) {
    const m = line.match(/^\*\*Test Types:\*\*\s*(.+)$/);
    if (!m) continue;
    for (const t of m[1].replace(/[[\]]/g, '').split(',')) {
      const v = t.trim();
      if (v) boardTypes.add(v);
    }
  }
  // vocabulary table in the strategy: lines "| `type` | level | ... |"
  const docTypes = new Set();
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const first = cells[1] || '';
    const m = first.match(/^`([a-z0-9-]+)`$/);
    if (m) docTypes.add(m[1]);
  }
  const uncovered = [...boardTypes].filter((t) => !docTypes.has(t)).sort();
  if (uncovered.length) {
    errors.push(`[${name}] board-alignment: board Test Types not covered by the document's vocabulary: ${uncovered.join(', ')}`);
  } else {
    info.push(`[${name}] board-alignment: all ${boardTypes.size} board Test Types covered (${[...boardTypes].sort().join(', ')})`);
  }
}

function checkHygiene(name, text) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const n = i + 1;
    for (const [re, label] of SECRET_SHAPES) {
      if (re.test(line)) findings.push(`line ${n}: secret-shaped material (${label})`);
    }
    if (FORBIDDEN_HINTS.test(line)) return; // documentation about an anti-pattern
    for (const m of line.matchAll(DOMAIN_RE)) {
      const domain = (m[1] || m[2] || '').toLowerCase();
      if (!domain) continue;
      if (ALLOWED_DOC_DOMAINS.has(domain)) continue;
      if (RESERVED_TLDS.some((tld) => domain.endsWith(tld))) continue;
      findings.push(`line ${n}: non-reserved / non-allowlisted domain "${domain}"`);
    }
    for (const m of line.matchAll(EMAIL_RE)) {
      const tld = m[1].toLowerCase();
      if (RESERVED_TLDS.some((t) => tld.endsWith(t) || tld === t)) continue;
      findings.push(`line ${n}: non-reserved email domain "${m[0]}"`);
    }
  });
  if (findings.length) errors.push(`[${name}] policy-hygiene: ${findings.join('; ')}`);
  else info.push(`[${name}] policy-hygiene: no secret-shaped material, non-reserved domain, or PII found`);
}

function checkTraceability(name, text) {
  const missing = REQUIRED_RULES.filter((rule) => !new RegExp(`\\b${rule}\\b`).test(text));
  if (missing.length) errors.push(`[${name}] traceability: SEC-001 rule(s) not referenced: ${missing.join(', ')}`);
  else info.push(`[${name}] traceability: all SEC-001 absolute rules ${REQUIRED_RULES.join(', ')} referenced`);
}

// ---------------------------------------------------------------- main
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['TEST_STRATEGY.md'];
const root = repoRoot();

console.log('doc-validation — Secure Password Manager');
console.log(`repo root: ${root}`);
console.log(`targets:   ${targets.join(', ')}`);
console.log('');

for (const target of targets) {
  const abs = path.isAbsolute(target) ? target : path.join(root, target);
  const name = path.relative(root, abs) || target;
  if (!existsSync(abs)) {
    errors.push(`[${name}] not found at ${abs}`);
    continue;
  }
  const st = statSync(abs);
  if (!st.isFile()) {
    errors.push(`[${name}] not a regular file`);
    continue;
  }
  const text = readFileSync(abs, 'utf8');
  console.log(`--- ${name} (${st.size} bytes, ${text.split('\n').length} lines) ---`);
  checkCompleteness(name, text);
  checkReferences(name, text, root);
  checkBoardAlignment(name, text, root);
  checkHygiene(name, text);
  checkTraceability(name, text);
  console.log('');
}

for (const line of info) console.log(`OK    ${line}`);
for (const line of warnings) console.log(`WARN  ${line}`);
for (const line of errors) console.log(`ERROR ${line}`);
console.log('');
console.log(`summary: ${info.length} ok, ${warnings.length} warning(s), ${errors.length} error(s)`);
if (errors.length) {
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS');
