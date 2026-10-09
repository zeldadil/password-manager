#!/usr/bin/env bash
# Runs the gate (read-only) on every live card whose comments carry the exception key,
# and prints the operative exception + violations/advisories relevant to this fix.
# Usage: bash live-delta.sh <repo-dir> <out.jsonl>
set -u
REPO="$1"; OUT="$2"
: > "$OUT"
export PATH="$HOME/.hermes/profiles/qa/cache/scratch/node22/bin:$PATH"
CARDS=$(sqlite3 -readonly "$HOME/.hermes/kanban.db" "SELECT DISTINCT task_id FROM task_comments WHERE body LIKE '%signoff%exception%' ORDER BY task_id;")
for t in $CARDS; do
  node "$REPO/scripts/qa/signoff-gate.mjs" check --task "$t" --db "$HOME/.hermes/kanban.db" --repo "$REPO" --json > "$OUT.tmp" 2>/dev/null
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const f = r.facts;
    console.log(JSON.stringify({
      task: f.task_id, status: f.status, security_track: f.security_track,
      exception: f.exception ? f.exception.author + ": " + f.exception.reason.slice(0, 60) : null,
      ignored: (f.exceptions_ignored || []).map((x) => x.author + "/" + x.why),
      violations: r.violations.map((v) => v.rule),
      adv: r.advisories.map((a) => a.rule).filter((a) => a.startsWith("X1") || a.startsWith("A10")),
    }));
  ' "$OUT.tmp" >> "$OUT"
done
rm -f "$OUT.tmp"
cat "$OUT"
