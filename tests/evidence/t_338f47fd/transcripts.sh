#!/usr/bin/env bash
# t_338f47fd — produce the standalone transcripts committed next to this script.
# Re-runnable; writes into tests/evidence/t_338f47fd/. The live board is copied,
# never written to.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
GATE="${REPO_ROOT}/scripts/qa/signoff-gate.mjs"
BOARD="${HERMES_KANBAN_DB:-${HOME}/.hermes/kanban.db}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/t_338f47fd-ev.XXXXXX")"
cd "$REPO_ROOT"

# prefix gate = the revision installed before this fix, from git (byte-exact)
git -C "$REPO_ROOT" show "HEAD^:scripts/qa/signoff-gate.mjs" > "$WORK/prefix-gate.mjs"
cp "$BOARD" "$WORK/board.db"

sha() { sha256sum "$1" | cut -d' ' -f1; }

# ── selftest: patched vs prefix gate ─────────────────────────────────────────
{
  echo "t_338f47fd — selftest against the FIXED gate (expected: 81/81, exit 0)"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "gate:     scripts/qa/signoff-gate.mjs sha256 $(sha "$GATE")"
  echo "selftest: scripts/qa/signoff-gate.selftest.mjs sha256 $(sha "${REPO_ROOT}/scripts/qa/signoff-gate.selftest.mjs")"
  echo "command:  node scripts/qa/signoff-gate.selftest.mjs"
  echo
  node scripts/qa/signoff-gate.selftest.mjs 2>&1
  rc=$?
  echo
  echo "exit: $rc"
} > "$HERE/selftest-GREEN-fixed-gate.txt" 2>&1

cp "$GATE" "$WORK/signoff-gate.mjs.fixed"
cp "$WORK/prefix-gate.mjs" "$WORK/signoff-gate.mjs"
cp "${REPO_ROOT}/scripts/qa/signoff-gate.selftest.mjs" "$WORK/signoff-gate.selftest.mjs"
{
  echo "t_338f47fd — the SAME suite against the PREFIX gate (the 8 new cases must be red)"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "prefix gate: $WORK/signoff-gate.mjs sha256 $(sha "$WORK/signoff-gate.mjs")  (the revision installed in all 7 profiles before this fix)"
  echo "command:     node <tmp>/signoff-gate.selftest.mjs"
  echo
  node "$WORK/signoff-gate.selftest.mjs" 2>&1
} > "$HERE/selftest-RED-prefix-gate.txt" 2>&1

# ── plain audit under both revisions, same board copy ────────────────────────
{
  echo "t_338f47fd — board audit under both revisions, same board copy"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "board copy: $WORK/board.db sha256 $(sha "$WORK/board.db")  (copy of $BOARD, taken at the date above)"
  echo "repo:       $REPO_ROOT"
  echo
  echo "── PREFIX gate ($(sha "$WORK/prefix-gate.mjs"))"
  node "$WORK/prefix-gate.mjs" audit --db "$WORK/board.db" --repo "$REPO_ROOT" --json > "$WORK/audit-prefix.json" 2>&1
  echo "exit: $?"
  node "$WORK/prefix-gate.mjs" audit --db "$WORK/board.db" --repo "$REPO_ROOT" 2>&1 | head -3
  echo
  echo "── FIXED gate ($(sha "$GATE"))"
  node "$GATE" audit --db "$WORK/board.db" --repo "$REPO_ROOT" --json > "$WORK/audit-fixed.json" 2>&1
  echo "exit: $?"
  node "$GATE" audit --db "$WORK/board.db" --repo "$REPO_ROOT" 2>&1 | head -3
  echo
  echo "── FAIL lines under the fixed gate (each with its rule ids)"
  node "$GATE" audit --db "$WORK/board.db" --repo "$REPO_ROOT" 2>&1 | grep -E "^  FAIL|^        " | head -40
} > "$HERE/audit-both-revisions.txt" 2>&1

# ── whole-board A/B (pristine copy) ──────────────────────────────────────────
{
  echo "t_338f47fd — whole-board A/B: violation sets before/after the §3 author rule"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "board copy: $WORK/board.db sha256 $(sha "$WORK/board.db")"
  echo
  node "$HERE/ab-live-audit.mjs" "$WORK/prefix-gate.mjs" "$GATE" "$WORK/board.db" "$REPO_ROOT" 2>&1
} > "$HERE/ab-live-audit.txt" 2>&1

# ── diff of the change ──────────────────────────────────────────────────────
{
  echo "t_338f47fd — diff of the gate fix (gate + selftest + policy doc) vs HEAD"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "HEAD: $(git -C "$REPO_ROOT" rev-parse --short HEAD) $(git -C "$REPO_ROOT" log -1 --format=%s)"
  echo
  git -C "$REPO_ROOT" diff -- scripts/qa/signoff-gate.mjs scripts/qa/signoff-gate.selftest.mjs QA_SIGN_OFF_GATE.md
} > "$HERE/gate-fix.diff" 2>&1

echo "wrote:"
ls -1 "$HERE" | sed 's/^/  /'
rm -rf "$WORK"
