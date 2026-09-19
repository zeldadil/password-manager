#!/usr/bin/env node
/**
 * scan-test-data.mjs — synthetic-data enforcement (SEC-001 AR-4).
 *
 * Implemented by QA-001e. Backs the `pnpm scan:test-data` pre-commit + CI check
 * named in TEST_STRATEGY.md §7.
 *
 * Scans test-relevant files (tests/, fixtures, snapshots, *.test|spec.*, and
 * E2E specs under apps/ and packages/) for forbidden real-world material:
 *
 *   1. real domains (any non-reserved TLD in a URL or bare hostname),
 *   2. dictionary / human-memorized passwords,
 *   3. secret-shaped material (private-key blocks, cloud tokens, JWTs, long
 *      base64 blobs, inline credential assignments),
 *   4. emails on non-reserved domains (PII).
 *
 * Reserved TLDs (.test, .invalid, .example, .localhost) and `localhost` are
 * exempt by design (AR-4). Markdown files may document an anti-pattern (a line
 * whose text carries a "forbidden"/"do not use" hint) without tripping the
 * scanner; source/test files get no such exemption — a forbidden value in test
 * code is a hard failure.
 *
 * Usage
 *   node scripts/qa/scan-test-data.mjs               # scan the repo's test tree
 *   node scripts/qa/scan-test-data.mjs path ...      # scan specific files/dirs
 *
 * Exit codes: 0 = clean, 1 = one or more findings.
 */

import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

// ------------------------------------------------------------------ patterns
const SECRET_SHAPES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub PAT"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\bsk-[A-Za-z0-9]{20,}\b/, "OpenAI-style API key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, "JWT"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/, "long base64 blob (possible key material)"],
  [/\b(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*["'][^"']{12,}["']/i, "inline credential assignment"],
];

const DICTIONARY_PASSWORDS = [
  "password123",
  "Password123!",
  "correct-horse-battery-staple",
  "correct horse battery staple",
  "letmein",
  "qwerty123",
  "admin123",
  "changeme",
  "hunter2",
  "P@ssw0rd",
  "welcome123",
  "iloveyou",
  "monkey123",
  "passw0rd",
  "secret123",
  "trustno1",
];

const RESERVED_TLDS = ["test", "invalid", "example", "localhost"];

// Common real TLDs to reject in URLs / bare hostnames. Kept to a curated list so
// code identifiers like `foo.bar.ts` are not falsely flagged as domains.
const REAL_TLDS = [
  "com", "net", "org", "io", "dev", "ai", "co", "uk", "us", "de", "fr", "es",
  "it", "nl", "ru", "cn", "jp", "in", "br", "ca", "au", "nz", "ch", "at", "be",
  "se", "no", "dk", "fi", "pl", "cz", "gr", "pt", "ie", "app", "cloud", "xyz",
  "info", "biz", "me", "tv", "gg", "sh", "so", "ly", "to", "im", "run", "site",
  "online", "tech", "store", "space", "fun", "live", "pro", "shop", "wtf",
];

const DOMAIN_RE = new RegExp(
  `\\bhttps?:\\/\\/[A-Za-z0-9.-]+\\.(${REAL_TLDS.join("|")})\\b|\\b[A-Za-z0-9-]+\\.(${REAL_TLDS.join("|")})\\b`,
  "gi",
);

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.(?:[A-Za-z]{2,}))\b/g;

const FORBIDDEN_HINTS = /forbidden|never use|not allowed|anti-pattern|must not|do not use/i;

// A line that asserts a value is NOT one of these patterns (negative test /
// hygiene assertion) is not test data — it is a test *about* hygiene.
const NEGATION_HINTS = /not\.to(Match|Equal|Be|Contain)|\bnot\s+(?:contain|equal|include|match)\b|!==|!=\b|must\s+not|should\s+not|does\s+not|is\s+not|\bnever\b|\bforbid|\breject/i;

// ------------------------------------------------------------------ helpers
function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".worktrees", "dist", "build", "coverage",
  ".nyc_output", ".cache", "test-results",
  // QA evidence transcripts (tests/evidence/) are report artifacts, not test
  // data — they may legitimately quote what this scanner flagged. The
  // whole-repo secret scan (gitleaks/truffleHog in the secret-scan job) remains
  // the backstop for real secrets committed under evidence.
  "evidence",
]);

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/;
const SNAP_DIR_RE = /__snapshots__/;

/** @param {boolean} all — when true, collect every file (used for `tests/`,
 *  which is entirely test data); when false, collect only test files (used for
 *  apps/ and packages/, whose source is production code). */
function collectFiles(dir, out = new Set(), all = false) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collectFiles(full, out, all);
    } else if (e.isFile()) {
      const isTest = all || TEST_FILE_RE.test(e.name) || SNAP_DIR_RE.test(full) || /\.snap$/.test(e.name);
      if (isTest) out.add(full);
    }
  }
  return out;
}

function defaultTargets(root) {
  const files = new Set();
  const testsDir = path.join(root, "tests");
  // everything under tests/ is test data (fixtures, snapshots, specs) — scan it all
  if (existsSync(testsDir)) collectFiles(testsDir, files, true);

  for (const base of ["apps", "packages"]) {
    const abs = path.join(root, base);
    if (!existsSync(abs)) continue;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      // only collect test files from app/package source, not production code
      collectFiles(path.join(abs, e.name), files, false);
    }
  }
  return [...files];
}

function normalizeTargets(root, argvPaths) {
  if (!argvPaths.length) return defaultTargets(root);
  const files = new Set();
  for (const p of argvPaths) {
    const abs = path.isAbsolute(p) ? p : path.join(root, p);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) collectFiles(abs, files, true);
    else if (st.isFile()) files.add(abs);
  }
  return [...files];
}

function scanText(text) {
  const findings = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const n = i + 1;
    const isDocLine = FORBIDDEN_HINTS.test(line);
    const isNegation = NEGATION_HINTS.test(line);

    for (const [re, label] of SECRET_SHAPES) {
      if (re.test(line)) findings.push(`line ${n}: secret-shaped material (${label})`);
    }

    // Dictionary passwords are only a finding when used as data, not when a
    // negative test or hygiene assertion lists them as something to reject.
    if (!isNegation && !isDocLine) {
      for (const pw of DICTIONARY_PASSWORDS) {
        if (line.toLowerCase().includes(pw.toLowerCase())) {
          findings.push(`line ${n}: dictionary/memorized password ("${pw}")`);
        }
      }
    }

    // real domains (URLs + bare hostnames) — no exemption for docs either,
    // since even explanatory prose should not embed a live real domain
    for (const m of line.matchAll(DOMAIN_RE)) {
      findings.push(`line ${n}: real (non-reserved) domain "${m[0]}"`);
    }

    for (const m of line.matchAll(EMAIL_RE)) {
      const tld = m[1].toLowerCase();
      if (RESERVED_TLDS.some((t) => tld.endsWith(`.${t}`) || tld === t)) continue;
      findings.push(`line ${n}: non-reserved email domain "${m[0]}"`);
    }
  });
  return findings;
}

// ------------------------------------------------------------------ main
const root = repoRoot();
const targets = normalizeTargets(root, process.argv.slice(2));

console.log("scan:test-data — synthetic-data enforcement (AR-4)");
console.log(`repo root: ${root}`);
console.log(`scanning:  ${targets.length} test file(s)`);
console.log("");

const allFindings = [];
let scanned = 0;
for (const file of targets.sort()) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.log(`  SKIP  ${path.relative(root, file)} (unreadable)`);
    continue;
  }
  scanned++;
  const findings = scanText(text);
  if (findings.length) {
    console.log(`  FAIL  ${path.relative(root, file)}`);
    for (const f of findings) {
      console.log(`        ${f}`);
      allFindings.push(`${path.relative(root, file)}:${f}`);
    }
  }
}

console.log("");
console.log(`scanned ${scanned} file(s), ${allFindings.length} finding(s)`);
if (allFindings.length) {
  console.log("RESULT: FAIL — synthetic-data policy violated");
  process.exit(1);
}
console.log("RESULT: PASS — no real secret, real domain, or dictionary password in test data");
process.exit(0);
