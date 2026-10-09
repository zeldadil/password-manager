#!/usr/bin/env bash
# t_75180b28 — reproduce the evidence for the R9/R10 gate rule.
#
#   bash tests/evidence/t_75180b28/reproduce.sh <out-dir>
#
# 1. GREEN: the selftest against this branch's gate.
# 2. RED:   the same selftest against the gate of the branch point
#           (origin/master before this change) — the R9/R10 cases must fail,
#           every pre-existing case must still pass.
# 3. LIVE:  `check --pre-complete` on real cards of the shared board, reading
#           real GitHub (needs an authenticated `gh`; read-only).
# 4. AUDIT: what the board audit would report if the rule epoch were moved
#           back to 2026-09-25 (measures false positives on real history).
#
# Run from the repo root. Writes transcripts only into <out-dir>.
set -uo pipefail
out="${1:?usage: reproduce.sh <out-dir>}"
mkdir -p "$out"
# Raw --json output carries board facts for every card: keep it out of the
# committed evidence, commit only the summaries.
raw="$(mktemp -d)"
base="${BASE_REF:-935b64b}"   # branch point: origin/master when t_75180b28 started

echo "== node $(node --version)" | tee "$out/env.txt"
gh --version | head -1 | tee -a "$out/env.txt"

echo "== 1. GREEN selftest"
node scripts/qa/signoff-gate.selftest.mjs > "$out/selftest-green.txt" 2>&1
echo "exit=$?" >> "$out/selftest-green.txt"
tail -2 "$out/selftest-green.txt"

echo "== 2. RED selftest (gate at $base, selftest from this branch)"
red="$(mktemp -d)"
git show "$base:scripts/qa/signoff-gate.mjs" > "$red/signoff-gate.mjs"
cp scripts/qa/signoff-gate.selftest.mjs "$red/"
sha256sum "$red/signoff-gate.mjs" > "$out/selftest-red-gate.sha256"
git rev-parse "$base:scripts/qa/signoff-gate.mjs" >> "$out/selftest-red-gate.sha256"
node "$red/signoff-gate.selftest.mjs" > "$out/selftest-red.txt" 2>&1
echo "exit=$?" >> "$out/selftest-red.txt"
tail -2 "$out/selftest-red.txt"

echo "== 3. LIVE checks against the shared board + real GitHub"
db="${HERMES_KANBAN_DB_LIVE:-$HOME/.hermes/kanban.db}"
: > "$out/live-checks.txt"
for t in ${LIVE_TASKS:-t_19128fb2 t_b8001b55 t_75180b28 t_cbaa9f7d t_d5e68535}; do
  echo "---- check --task $t --pre-complete" >> "$out/live-checks.txt"
  env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u QA_GATE_GITHUB_FIXTURE \
    node scripts/qa/signoff-gate.mjs check --task "$t" --pre-complete --db "$db" --repo "$PWD" --json \
    > "$raw/live-$t.json" 2>&1
  echo "exit=$?" >> "$out/live-checks.txt"
  node "$(dirname "$0")/summarize.mjs" "$raw/live-$t.json" >> "$out/live-checks.txt"
done
cat "$out/live-checks.txt"

echo "== 4. AUDIT with the rule epoch moved back to 2026-09-25 (measurement only)"
env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u QA_GATE_GITHUB_FIXTURE \
  node scripts/qa/signoff-gate.mjs audit --db "$db" --repo "$PWD" --json --pr-epoch-iso 2026-09-25T00:00:00Z \
  > "$raw/audit-epoch-0925.json" 2>&1
echo "exit=$?" > "$out/audit-epoch-0925.txt"
node "$(dirname "$0")/summarize.mjs" "$raw/audit-epoch-0925.json" --audit >> "$out/audit-epoch-0925.txt"
cat "$out/audit-epoch-0925.txt"
