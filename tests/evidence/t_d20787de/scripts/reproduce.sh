#!/bin/bash
# tests/evidence/t_d20787de/scripts/reproduce.sh — re-derive the measurements of card t_d20787de.
#
# Prerequisites:
#   * a full clone of zeldadil/password-manager with all refs fetched, at $REPO (default:
#     /home/sap/password-manager-check) and a worktree of branch qa/t_d20787de-retro-verify,
#   * the reviewed gate revision present in that worktree:
#     scripts/qa/signoff-gate.mjs sha256 85dbc127b6262eb91133ddaf6c70b96cfdb9407bd26784717558f8452eafd814
#     (installed in all 7 profiles; master still ships 44e15f95…, which lacks the §3 author rule),
#   * node >= 22, sqlite3, gitleaks 8.30.1, trufflehog 3.97.5, gh (authenticated),
#   * the kanban board at $HERMES_KANBAN_DB (default ~/.hermes/kanban.db).
#
# The live board is only ever READ (`sqlite3 .backup` into a temporary copy); this script never writes to it.
# Nothing prints a secret: token-shaped strings are counted or classified by sha256 prefix, never echoed.
set -u
GATE_WT="${GATE_WT:-/home/sap/password-manager-check/.worktrees/t_d20787de}"
BOARD="${HERMES_KANBAN_DB:-/home/sap/.hermes/kanban.db}"
WORK="${WORK:-$(mktemp -d)}"
CARDS="t_e348e0b7 t_28951254 t_2162d273 t_527d4720 t_80fc0326 t_c3cb6842"
TOKPAT='[0-9]{8,12}:[A-Za-z0-9_-]{35}'

echo "== 0. the gate revision under test =="
sha256sum "$GATE_WT/scripts/qa/signoff-gate.mjs"

echo
echo "== 1. snapshot the board (read-only) and audit it =="
sqlite3 -- "$BOARD" ".backup '$WORK/board.db'"
( cd "$GATE_WT" && env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE \
    node scripts/qa/signoff-gate.mjs audit --db "$WORK/board.db" --repo "$GATE_WT" )
echo "copy: $WORK/board.db  sha256 $(sha256sum "$WORK/board.db" | cut -d' ' -f1)"

echo
echo "== 2. the in-scope cards' verdict records and their current rule results =="
for card in $CARDS; do
  printf '\n--- %s\n' "$card"
  sqlite3 -- "$WORK/board.db" "SELECT id||' | '||author||' | '||datetime(created_at,'unixepoch')||' | '||substr(replace(body,char(10),' '),1,140) FROM task_comments WHERE task_id='$card' AND author='qa' ORDER BY created_at DESC LIMIT 2;"
  ( cd "$GATE_WT" && env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE \
      node scripts/qa/signoff-gate.mjs check --task "$card" --db "$WORK/board.db" --repo "$GATE_WT" ) | sed -n '2,12p'
done

echo
echo "== 3. the loose-path false positive, re-derived from the board =="
node - "$WORK/board.db" <<'JS'
const { execFileSync } = require("node:child_process");
const marker = /(?:^|[\s(])qa[\s_-]*verdict\s*:\s*([a-z][a-z-]*)/i;
const loose = /verdict\s*[:.\-—]+\s*([a-z][a-z-]*)/i;
for (const c of JSON.parse(execFileSync("sqlite3", ["-json", "--", process.argv[2],
  "SELECT id,author,body FROM task_comments WHERE task_id='t_80fc0326' AND author='qa'"], { encoding: "utf8" }))) {
  const l = loose.exec(c.body || "");
  console.log(`  comment ${c.id}: marker=${JSON.stringify((marker.exec(c.body || "") || [])[1] || null)} loose=${JSON.stringify(l ? l[1].toLowerCase() : null)}`);
}
JS

echo
echo "== 4. the wired sensor, re-run (redacted) =="
( cd "$GATE_WT" && trufflehog git "file://$GATE_WT" --no-update --results=verified,unknown --fail --json 2>&1 \
    | sed -E 's/[0-9]{8,12}:[A-Za-z0-9_-]{35}/<TOKEN-REDACTED>/g' | grep -o '"verified_secrets":[0-9]*\|"unverified_secrets":[0-9]*' | tail -2 )
echo "  (exit code 183 = findings, 0 = clean)"

echo
echo "== 5. every token-shaped string on the remote branch tips, classified =="
bash "$GATE_WT/tests/evidence/t_d20787de/scripts/classify-token-hits.py" 2>&1 | sed -n '1,40p' || \
  echo "  (run scripts/classify-token-hits.py from this bundle; it needs the clone at REPO=/home/sap/password-manager-check)"

echo
echo "== 6. self-check: no token-shaped string may appear in this bundle =="
grep -r -c -E "$TOKPAT" "$GATE_WT/tests/evidence/t_d20787de/" | grep -v ':0$' || echo "  clean (0 matches in every file)"
