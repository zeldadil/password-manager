#!/usr/bin/env node
/**
 * probe-loose-path.mjs — t_df8e644a reproduction probe.
 *
 * Two views over a board copy, both sourced from the gate under test:
 *
 *   A. **exact spans** — the gate's own `VERDICT_LOOSE_RE` / `VERDICT_MARKER_RE`
 *      literals are read out of the gate source and applied to every comment, so
 *      each match is printed at its real offset with ±70 characters of context.
 *      A token read out of a *file name* is then visible as one.
 *   B. **the gate's decision** — `collectVerdicts(board, task)` (the exported
 *      collector the rules use) for every card, with source and raw token, so the
 *      spans above can be tied to what the gate actually records.
 *
 * Pass the gate module explicitly to run the same probe against the pre-fix
 * revision (the reproduction) and the fixed one (the control):
 *   node probe-loose-path.mjs --gate <signoff-gate.mjs> --db <board.db> [--all-cards]
 * Without `--all-cards` only the cards that carry a verdict record are listed in view B.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};

const gatePath = arg("--gate");
const dbPath = arg("--db");
if (!gatePath || !dbPath) {
  console.error("usage: probe-loose-path.mjs --gate <gate.mjs> --db <board.db> [--all-cards]");
  process.exit(2);
}

const source = readFileSync(gatePath, "utf8");
const sha = createHash("sha256").update(source).digest("hex");
const { loadBoard, collectVerdicts } = await import(pathToFileURL(gatePath).href);

/** Read a regex literal out of the gate source and rebuild it (no guessing). */
function literal(name) {
  const m = new RegExp(`^const ${name} = /(.*)/([a-z]*);\\s*$`, "m").exec(source);
  if (!m) throw new Error(`${name} not found in ${gatePath}`);
  return { re: new RegExp(m[1], m[2]), text: `/${m[1]}/${m[2]}` };
}

const loose = literal("VERDICT_LOOSE_RE");
const marker = literal("VERDICT_MARKER_RE");

const board = loadBoard(dbPath);

console.log(`=== t_df8e644a probe — was: does a cited path read as a verdict token?`);
console.log(`gate      : ${gatePath}`);
console.log(`gate sha256: ${sha}`);
console.log(`board     : ${dbPath}`);
console.log(`cards     : ${board.tasks.length}   comments: ${[...board.commentsByTask.values()].reduce((n, c) => n + c.length, 0)}`);
console.log(`\nVERDICT_MARKER_RE = ${marker.text}`);
console.log(`VERDICT_LOOSE_RE  = ${loose.text}`);

/** ±window characters around `index` in `text`, flattened to a single line. */
function context(text, index, length, window = 70) {
  const from = Math.max(0, index - window);
  const to = Math.min(text.length, index + length + window);
  const flat = text.slice(from, to).replace(/\s+/g, " ");
  return `${from > 0 ? "…" : ""}${flat}${to < text.length ? "…" : ""}`;
}

console.log("\n── A. exact spans — every verdict-comment regex match on a qa-authored comment:");
const allAuthors = argv.includes("--all-authors");
if (allAuthors) console.log("   (--all-authors: every author, used for the residual scan — the gate itself only reads qa comments)");
let looseHits = 0;
let markerHits = 0;
let pathShaped = 0;
for (const task of board.tasks) {
  for (const c of board.commentsByTask.get(task.id) || []) {
    const text = c.body || "";
    const author = String(c.author || "").trim();
    if (!allAuthors && author !== "qa") continue;
    const mk = marker.re.exec(text);
    if (mk && !allAuthors) {
      markerHits++;
      console.log(`   ${task.id}  MARKER  "${mk[1]}"  @${mk.index}  ${context(text, mk.index, mk[0].length)}`);
      continue; // the collector stops here too
    }
    const lo = loose.re.exec(text);
    if (!lo) continue;
    looseHits++;
    const span = lo[0];
    const isPath = /[/\\][^\s]*$/.test(text.slice(Math.max(0, lo.index - 40), lo.index)) || /^[A-Za-z0-9_.-]*\.[a-z]{1,8}\b/.test(text.slice(lo.index + span.length));
    if (isPath) pathShaped++;
    console.log(`   ${task.id}${allAuthors ? ` [${author}]` : ""}  loose   "${lo[1]}"  @${lo.index}${isPath ? "  <-- THE MATCH SITS IN A PATH" : ""}`);
    console.log(`        ${context(text, lo.index, span.length)}`);
  }
}
console.log(`   marker matches on qa comments: ${markerHits}   loose matches: ${looseHits}   of which path-shaped: ${pathShaped}`);

console.log("\n── B. what the gate records (collectVerdicts) — cards that carry a record:");
for (const task of board.tasks) {
  const verdicts = collectVerdicts(board, task);
  if (!verdicts.length && !argv.includes("--all-cards")) continue;
  console.log(`   ${task.id} (${task.status}, ${task.assignee})`);
  if (!verdicts.length) console.log("     (no verdict record)");
  for (const v of verdicts) {
    console.log(`     ${v.source.padEnd(13)} "${v.raw}" -> "${v.token}"  by ${v.author ?? "?"}`);
  }
}
