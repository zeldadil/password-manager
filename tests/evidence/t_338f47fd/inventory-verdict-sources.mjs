#!/usr/bin/env node
/**
 * t_338f47fd — inventory of every verdict source on the live board, by author.
 * Read-only: loads the board copy and prints, per card, each source the gate's
 * own `collectVerdicts` sees, so we can measure the blast radius of adding an
 * author check to the marker path (and of extending it to run metadata).
 *
 * Usage: node analyze-verdict-sources.mjs <gate.mjs> <board.db>
 */
import { pathToFileURL } from "node:url";

const gatePath = process.argv[2];
const dbPath = process.argv[3];
const gate = await import(pathToFileURL(gatePath).href);
const board = gate.loadBoard(dbPath);

const QA = "qa";
const rows = [];
for (const t of board.tasks) {
  const vs = gate.collectVerdicts(board, t);
  if (!vs.length) continue;
  for (const v of vs) {
    const author = String(v.author || "").trim();
    rows.push({
      task: t.id,
      status: t.status,
      completed: t.completed_at ? new Date(t.completed_at * 1000).toISOString() : null,
      source: v.source,
      author,
      token: v.token,
      raw: v.raw,
      at: v.at,
      nonQa: author !== QA,
      valid: gate.VERDICTS.has(v.token),
    });
  }
}

const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
console.log("task        status  source          author      token                     valid  at(iso)");
for (const r of rows) {
  console.log(
    [
      pad(r.task, 12),
      pad(r.status, 8),
      pad(r.source, 16),
      pad(r.author || "-", 12),
      pad(r.raw, 26),
      pad(r.valid ? "yes" : "NO", 6),
      r.at ? new Date(Number(r.at) * 1000).toISOString() : "-",
    ].join(" "),
  );
}

// Cards whose *operative* (newest valid) verdict comes from a non-QA source.
const byTask = new Map();
for (const r of rows) {
  if (!byTask.has(r.task)) byTask.set(r.task, []);
  byTask.get(r.task).push(r);
}
console.log("\n--- operative (newest) verdict per task, and its author ---");
const suspects = [];
for (const [task, list] of byTask) {
  const sorted = [...list].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  const op = sorted[sorted.length - 1];
  const flag = op.nonQa && op.valid ? "  <== NON-QA OPERATIVE" : "";
  console.log(`${task} status=${pad(op.status, 8)} op-source=${pad(op.source, 16)} author=${pad(op.author || "-", 12)} token=${pad(op.token, 22)} valid=${op.valid ? "yes" : "NO"}${flag}`);
  if (op.nonQa && op.valid) suspects.push({ task, ...op });
}
console.log(
  `\nnon-QA *valid* verdict sources on the board: ${rows.filter((r) => r.nonQa && r.valid).length}; of which operative: ${suspects.length}`,
);
for (const s of suspects) console.log(`  OPERATIVE-NON-QA ${s.task} (${s.status}) via ${s.source} by ${s.author}: ${s.raw}`);

// Any non-QA marker comment at all (the defect's front door), regardless of position.
console.log("\n--- marker-comment verdicts authored by a non-QA profile (the defect class) ---");
const markerNonQa = rows.filter((r) => r.source === "marker-comment" && r.nonQa);
for (const r of markerNonQa) console.log(`  ${r.task} (${r.status}) by ${r.author}: ${r.raw}  [valid=${r.valid ? "yes" : "NO"}]`);
console.log(`  count: ${markerNonQa.length}`);
