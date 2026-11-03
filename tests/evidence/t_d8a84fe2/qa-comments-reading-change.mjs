import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { looseVerdict } from "../../../scripts/qa/signoff-gate.mjs";
const src = readFileSync("<master gate copy>", "utf8");
const lit = (n) => eval(src.match(new RegExp(`const ${n} = (\\/.*\\/[a-z]*);`))[1]);
const MARKER = lit("VERDICT_MARKER_RE"), LOOSE = lit("VERDICT_LOOSE_RE");
const db = new DatabaseSync("<board snapshot>", { readOnly: true });
const rows = db.prepare("SELECT c.id, c.task_id, t.status, c.body FROM task_comments c JOIN tasks t ON t.id=c.task_id WHERE c.author='qa' ORDER BY c.id").all();
let loose = 0, diff = 0;
for (const c of rows) {
  const t = c.body || "";
  if (MARKER.exec(t)) continue;
  const o = LOOSE.exec(t), n = looseVerdict(t);
  if (o || n) loose++;
  if ((o ? o[1].toLowerCase() : null) !== (n ? n[1].toLowerCase() : null)) {
    diff++;
    const i = o ? o.index : n.index;
    console.log(`#${c.id} ${c.task_id} [${c.status}] old=${o ? o[1] : "-"} new=${n ? n[1] : "-"} @ ${JSON.stringify(t.slice(Math.max(0, i - 60), i + 30))}`);
  }
}
console.log(`qa comments: ${rows.length}; read by the loose path (no marker): ${loose}; reading changed: ${diff}`);
