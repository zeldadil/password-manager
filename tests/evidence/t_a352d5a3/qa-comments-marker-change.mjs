import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { markerVerdict } from "../../../scripts/qa/signoff-gate.mjs";
const src = readFileSync("<master gate copy>", "utf8");
const MARKER = eval(src.match(/const VERDICT_MARKER_RE = (\/.*\/[a-z]*);/)[1]);
const db = new DatabaseSync("<board snapshot>", { readOnly: true });
const rows = db.prepare("SELECT c.id, c.task_id, t.status, c.body FROM task_comments c JOIN tasks t ON t.id=c.task_id WHERE c.author='qa' ORDER BY c.id").all();
let withMarker = 0, diff = 0;
for (const c of rows) {
  const t = c.body || "";
  const o = MARKER.exec(t), n = markerVerdict(t);
  if (o) withMarker++;
  const a = o ? o[1].toLowerCase() : null, b = n ? n[1].toLowerCase() : null;
  if (a !== b || (o && n && o.index !== n.index)) {
    diff++;
    console.log(`#${c.id} ${c.task_id} [${c.status}] old=${a ?? "-"} new=${b ?? "- (falls to loose path)"} @ ${JSON.stringify(t.slice(Math.max(0, o.index - 50), o.index + 40))}`);
  }
}
console.log(`qa comments: ${rows.length}; with a marker (old regex): ${withMarker}; marker reading changed: ${diff}`);
