#!/bin/bash
# t_d20787de — M3/M4/M6: evidence README on master, the FE-001d mechanism follow-through,
# the ROTATION R2 source (gate regex applied to the real comment bodies), and the gitleaks rule breakdown.
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
CLONE=/home/sap/password-manager-check
WT="$CLONE/.worktrees/t_d20787de"
OUT="$SCR/m3-m4-m6.txt"

{
echo "=== M3. master tests/evidence/t_e348e0b7/README.md ==="
git -C "$CLONE" show origin/master:tests/evidence/t_e348e0b7/README.md
echo
echo "=== M3b. gitleaks 8.30.1 findings over the clone (rule + file, redacted) ==="
python3 - <<'PY'
import json, re
p = "/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch/.gl-raw.json"
try:
    data = json.load(open(p))
except Exception as e:
    print("  (report unreadable:", e, ")"); raise SystemExit
print(f"  findings: {len(data)}")
for f in data:
    print(f"    {f.get('RuleID'):<26} {f.get('File')}  line={f.get('StartLine')} commit={str(f.get('Commit'))[:7]} secret=<REDACTED>")
PY
echo
echo "=== M4. t_2162d273 — is the decided mechanism actually present in the repo? (dataset.theme writer) ==="
echo "--- refs containing 'dataset.theme' ---"
git -C "$CLONE" grep -l "dataset\.theme\|documentElement\.dataset" $(git -C "$CLONE" for-each-ref --format='%(refname)' refs/remotes/origin | grep -v HEAD) 2>/dev/null | sed 's/^/  /' | head -20
echo "--- owner cards on the board ---"
sqlite3 -- "$HERMES_KANBAN_DB" "SELECT id||' | '||assignee||' | '||status||' | '||title FROM tasks WHERE id IN ('t_e2b31691','t_aca6ed13');"
echo
echo "=== M6. which comment produces R2 verdict \"ROTATION\" on t_80fc0326 (gate regexes on the real bodies) ==="
node - <<'JS'
const { execFileSync } = require("node:child_process");
const marker = /(?:^|[\s(])qa[\s_-]*verdict\s*:\s*([a-z][a-z-]*)/i;
const loose = /verdict\s*[:.\-—]+\s*([a-z][a-z-]*)/i;
const deferral = /(?:^|[\s(])qa[\s_-]*verdict\s*[:.\-—]+\s*deferred/i;
const exception = /qa[\s_-]*signoff[\s_-]*exception\s*[:.\-—]+\s*(\S[^\n]*)/i;
const db = process.env.HERMES_KANBAN_DB || "/home/sap/.hermes/kanban.db";
const rows = execFileSync("sqlite3", ["-json", "--", db,
  "SELECT id,author,body FROM task_comments WHERE task_id='t_80fc0326' ORDER BY created_at ASC, id ASC"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
for (const c of JSON.parse(rows || "[]")) {
  if (!["qa", "architect", "dashboard"].includes(c.author)) continue;
  const m = marker.exec(c.body || "");
  const l = loose.exec(c.body || "");
  if (!m && !l) continue;
  const src = l ? l[0] : "(none)";
  const at = l ? (c.body || "").slice(Math.max(0, l.index - 60), l.index + 40).replace(/\n/g, " / ") : "";
  console.log(`  comment ${c.id} by ${c.author}: marker=${m ? JSON.stringify(m[1]) : "-"} loose=${JSON.stringify(src)}`);
  console.log(`      context: …${at}…`);
}
console.log("  (deferral markers on the card by qa: " + (JSON.parse(rows).filter(c => c.author === "qa" && deferral.test(c.body || "")).length) + ")");
console.log("  (exception markers by any author: " + (JSON.parse(rows).filter(c => exception.test(c.body || "")).length) + ")");
JS
} 2>&1 | tee "$OUT"
echo "--- leak self-check ---"
grep -c -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$OUT" || true
