#!/usr/bin/env bash
# reproduce.sh — regenerate every number in docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md
#
# Usage:
#   REPO=<path to a full clone of zeldadil/password-manager> \
#   BOARD=<path to the kanban sqlite board> \
#   OUT=<dir for fresh evidence> \
#   bash reproduce.sh
#
# Defaults: REPO=$PWD (a full clone, all refs), BOARD=$HOME/.hermes/kanban.db, OUT=$PWD/repro-out
# Requirements: node >= 22, sqlite3, git (network access for the shallow-clone step).
set -euo pipefail

REPO=${REPO:-$PWD}
BOARD=${BOARD:-$HOME/.hermes/kanban.db}
OUT=${OUT:-$PWD/repro-out}
# resolve the directory this script (and the analysis scripts) live in BEFORE any cd
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"

echo "== inputs =="
echo "repo  : $REPO"
echo "board : $BOARD"
echo "out   : $OUT"
node --version
sqlite3 --version | head -1

# ── the two gate revisions ────────────────────────────────────────────────────
# installed / reviewed revision (PR #25) — take it from the branch that ships it
git -C "$REPO" show origin/qa/t_58280940-r8-stale-deferral:scripts/qa/signoff-gate.mjs > "$OUT/gate-pr25.mjs"
# master's revision (what CI checks out today)
git -C "$REPO" show origin/master:scripts/qa/signoff-gate.mjs > "$OUT/gate-master.mjs"
echo
echo "== gate revisions =="
sha256sum "$OUT/gate-pr25.mjs" "$OUT/gate-master.mjs"

# ── board dump (NOT to be committed: public repo) ─────────────────────────────
sqlite3 -json "$BOARD" \
  "SELECT id,title,assignee,status,created_by,created_at,completed_at,COALESCE(body,'') AS body,COALESCE(result,'') AS result FROM tasks ORDER BY created_at" \
  > "$OUT/board-tasks.json"
sqlite3 -json "$BOARD" \
  "SELECT task_id,author,substr(COALESCE(body,''),1,6000) AS body,created_at FROM task_comments ORDER BY task_id,created_at" \
  > "$OUT/board-comments.json"
echo
echo "== board size =="
sqlite3 "$BOARD" "SELECT COUNT(*) FROM tasks"

# ── item 2: the audits ───────────────────────────────────────────────────────
cd "$REPO"
echo
echo "== item 2 — default audit (enforced view) =="
node "$OUT/gate-pr25.mjs" audit --db "$BOARD" --repo "$REPO" | tee "$OUT/audit-default.txt" | tail -3 || true
node "$OUT/gate-pr25.mjs" audit --db "$BOARD" --repo "$REPO" --json > "$OUT/audit-default.json" || true
echo "== item 2 — strict-history audit (retrofit view) =="
node "$OUT/gate-pr25.mjs" audit --db "$BOARD" --repo "$REPO" --strict-history | tee "$OUT/audit-strict-history.txt" | tail -3 || true
node "$OUT/gate-pr25.mjs" audit --db "$BOARD" --repo "$REPO" --strict-history --json > "$OUT/audit-strict-history.json" || true

# ── item 1 S1: full vs shallow checkout ──────────────────────────────────────
echo
echo "== item 1 S1 — shallow checkout =="
SHALLOW="$OUT/shallow"
rm -rf "$SHALLOW"
git clone --quiet --depth 1 --single-branch --branch master "$(git -C "$REPO" remote get-url origin)" "$SHALLOW"
node "$OUT/gate-pr25.mjs" audit --db "$BOARD" --repo "$SHALLOW" --json > "$OUT/job-B-shallow-clone.json" || true
# scenario A (full clone) is audit-default.json — the runs are byte-identical

# ── item 1 S2: master's gate revision over the same board ────────────────────
echo
echo "== item 1 S2 — master gate revision =="
node "$OUT/gate-master.mjs" audit --db "$BOARD" --repo "$REPO" --json > "$OUT/audit-master-gate.json" || true
node "$OUT/gate-master.mjs" audit --db "$BOARD" --repo "$REPO" > "$OUT/audit-master-gate.txt" || true

# ── analyses (scripts shipped next to this file; they read $EVIDENCE_DIR) ─────
export EVIDENCE_DIR="$OUT"
cd "$HERE"
node analyze.mjs        > "$OUT/analysis.txt"           2>&1 || true
node r7-analysis.mjs    > "$OUT/r7-analysis.txt"        2>&1 || true
node r7-tokens.mjs      > "$OUT/r7-tokens.txt"          2>&1 || true
node r7-variants.mjs    > "$OUT/r7-variants.txt"        2>&1 || true
node ab-compare.mjs     > "$OUT/ab-gate-revisions.txt"  2>&1 || true
node replay-compare.mjs > "$OUT/job-replay-compare.txt" 2>&1 || true

echo
echo "== expected headline numbers (at the 129-card snapshot shipped in this directory) =="
echo "default audit            : 6 FAIL / 16 enforced / 27 grandfathered"
echo "strict-history audit     : 30 FAIL (24 of them pre-epoch)"
echo "master gate revision     : 8 FAIL (+2 R8 false positives)"
echo "shallow checkout         : 8 FAIL (+2 R5 false positives)"
echo "R7 flagged / in-scope    : 7 / 25 cards (18 missed, qa-assigned excluded)"
echo "(on a live board the counts move as cards are added: the audit is snapshot-dependent by design)"
echo
echo "evidence written to $OUT"
