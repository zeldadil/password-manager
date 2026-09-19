#!/bin/bash
# t_d20787de — regenerate loose-path-repro.txt with the audit rows scoped to t_80fc0326 only.
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
WT=/home/sap/password-manager-check/.worktrees/t_d20787de
EV="$WT/tests/evidence/t_d20787de"
LIVE="${HERMES_KANBAN_DB:-/home/sap/.hermes/kanban.db}"

{
echo "=== the loose-path false positive, reproduced from the live board (read-only) ==="
echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "gate revision under which the audit numbers were produced: sha256 85dbc127b6262eb91133ddaf6c70b96cfdb9407bd26784717558f8452eafd814"
echo
echo "-- the gate's two regexes (scripts/qa/signoff-gate.mjs):"
grep -n "const VERDICT_MARKER_RE\|const VERDICT_LOOSE_RE" "$WT/scripts/qa/signoff-gate.mjs"
echo
echo "-- applied to every qa-authored comment on t_80fc0326:"
node - "$LIVE" <<'JS'
const { execFileSync } = require("node:child_process");
const marker = /(?:^|[\s(])qa[\s_-]*verdict\s*:\s*([a-z][a-z-]*)/i;
const loose = /verdict\s*[:.\-—]+\s*([a-z][a-z-]*)/i;
const rows = JSON.parse(execFileSync("sqlite3", ["-json", "--", process.argv[2],
  "SELECT id,author,body FROM task_comments WHERE task_id='t_80fc0326' ORDER BY created_at ASC, id ASC"], { encoding: "utf8" }));
for (const c of rows) {
  if (String(c.author).trim() !== "qa") continue;
  const m = marker.exec(c.body || "");
  const l = loose.exec(c.body || "");
  console.log(`comment ${c.id} (author ${c.author})`);
  console.log(`  marker regex: ${m ? JSON.stringify(m[1]) : "no match"}`);
  console.log(`  loose  regex: ${l ? JSON.stringify(l[0]) + "  → token " + JSON.stringify(l[1].toLowerCase()) : "no match"}`);
  if (l) console.log(`  matched inside: …${(c.body || "").slice(Math.max(0, l.index - 90), l.index + l[0].length + 30).replace(/\n/g, " / ")}…`);
}
JS
echo
echo "-- the audit rows for THIS card only (identical in audit-t0.txt and audit-t1.txt):"
echo "   t0:"
awk '/^  FAIL t_80fc0326 /{f=1;print;next} /^  (FAIL|ok) /{if(f)exit} f&&/R[0-9]/{print}' "$SCR/audit-t0.txt"
echo "   t1:"
awk '/^  FAIL t_80fc0326 /{f=1;print;next} /^  (FAIL|ok) /{if(f)exit} f&&/R[0-9]/{print}' "$SCR/audit-t1.txt"
echo
echo "-- why 'ROTATION' is a false positive: the matched span is part of the file name"
echo "   tests/evidence/t_0af5aa3e/QA-VERDICT-ROTATION.md, cited inside a code span in comment 49 — a path, not a"
echo "   verdict token. t_c3cb6842 fixed the marker path (colon-only separator); VERDICT_LOOSE_RE still accepts"
echo "   '-' and '.' as separators, so the same file name is still parsed as a token by the loose path."
echo
echo "-- why 'CHANGES' ×2 is a correct report, not a false positive: comments 62/63 are real qa review records"
echo "   with a token outside the §12 vocabulary; the gate is right to flag them and only history-editing would clear them."
} > "$EV/loose-path-repro.txt" 2>&1
sed -n '1,40p' "$EV/loose-path-repro.txt"
