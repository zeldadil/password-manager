#!/usr/bin/env bash
# t_90a4bd73 — reproduce the R7 before/after audit tables.
#
#   bash tests/evidence/t_90a4bd73/run-audits.sh <board.db> <out-dir>
#
# Takes a consistent snapshot of <board.db> (sqlite3 .backup), then runs
# `audit --strict-history --json` three times on that ONE snapshot:
#   before    — the gate at the base commit 626feb7 (v1), extracted with git show
#   after     — this branch's gate (scope-v2, default R7_V2_EPOCH_ISO)
#   no-epoch  — this branch's gate with --r7-v2-epoch-iso 2026-09-17T15:00:00Z
#               (counterfactual: scope-v2 enforced on every post-gate-epoch card)
# and writes the markdown tables plus a run log with every exit code and sha256.
# Raw board content and raw audit JSON stay in <out-dir> (keep it OUTSIDE the
# repo: public repo, t_7dd3b960 hygiene rule).
set -u
BOARD="$1"
OUT="$2"
BASE=626feb7
mkdir -p "$OUT"
LOG="$OUT/run-log.txt"
: > "$LOG"
log() { printf '%s\n' "$*" | tee -a "$LOG"; }

sqlite3 "$BOARD" ".backup '$OUT/board-snapshot.db'"
git show "$BASE:scripts/qa/signoff-gate.mjs" > "$OUT/gate-$BASE.mjs"
git show "$BASE:scripts/qa/secret-guard.mjs" > "$OUT/secret-guard.mjs"

log "date (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "node: $(node --version)"
log "branch head: $(git rev-parse --short HEAD)"
log "board snapshot sha256: $(sha256sum "$OUT/board-snapshot.db" | cut -d' ' -f1) (not committed)"
log "gate before ($BASE) sha256: $(sha256sum "$OUT/gate-$BASE.mjs" | cut -d' ' -f1)"
log "gate after (working tree) sha256: $(sha256sum scripts/qa/signoff-gate.mjs | cut -d' ' -f1)"

node "$OUT/gate-$BASE.mjs" audit --db "$OUT/board-snapshot.db" --repo . --strict-history --json > "$OUT/audit-before.json"
log "before:   node gate-$BASE.mjs audit --strict-history --json → exit $?"
node scripts/qa/signoff-gate.mjs audit --db "$OUT/board-snapshot.db" --repo . --strict-history --json > "$OUT/audit-after.json"
log "after:    node scripts/qa/signoff-gate.mjs audit --strict-history --json → exit $?"
node scripts/qa/signoff-gate.mjs audit --db "$OUT/board-snapshot.db" --repo . --strict-history --json --r7-v2-epoch-iso 2026-09-17T15:00:00Z > "$OUT/audit-after-no-epoch.json"
log "no-epoch: node scripts/qa/signoff-gate.mjs audit --strict-history --json --r7-v2-epoch-iso 2026-09-17T15:00:00Z → exit $?"

node tests/evidence/t_90a4bd73/r7-before-after.mjs --db "$OUT/board-snapshot.db" --before "$OUT/audit-before.json" --after "$OUT/audit-after.json" > "$OUT/before-after.md"
log "table (before → after): exit $?"
node tests/evidence/t_90a4bd73/r7-before-after.mjs --db "$OUT/board-snapshot.db" --before "$OUT/audit-before.json" --after "$OUT/audit-after-no-epoch.json" > "$OUT/before-after-no-epoch.md"
log "table (before → no-epoch): exit $?"
