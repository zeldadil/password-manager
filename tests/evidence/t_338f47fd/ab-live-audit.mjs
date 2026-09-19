#!/usr/bin/env node
/**
 * t_338f47fd — whole-board A/B: what does adding the §3 author rule change?
 *
 * Loads the same board **copy** with both gate revisions and evaluates every
 * `done` card, then prints the set difference of the *violations*:
 *
 *   newly failing   — a card the fix stops passing (its verdict was a non-QA
 *                     marker: exactly the defect instances);
 *   cleared         — a card the fix stops failing (a non-QA marker used to
 *                     create R2/R3; that record is no longer a verdict);
 *   unchanged       — same violation set on both revisions (no collateral
 *                     damage: the fix must not disturb any other rule).
 *
 * Also prints the advisory delta (A7/A8 are new, and only they may appear).
 *
 * Usage: node tests/evidence/t_338f47fd/ab-live-audit.mjs <prefix-gate> <fixed-gate> <board.db> <repo>
 */
import { pathToFileURL } from "node:url";

const [prefixPath, fixedPath, dbPath, repo] = process.argv.slice(2);

const load = async (p) => await import(pathToFileURL(p).href);
const oldGate = await load(prefixPath);
const newGate = await load(fixedPath);

const oldBoard = oldGate.loadBoard(dbPath);
const newBoard = newGate.loadBoard(dbPath);

const key = (r) => r.rule;
const sig = (res) => res.violations.map(key).sort().join(",") || "-";

const rows = [];
for (const task of oldBoard.tasks) {
  if (task.status !== "done") continue;
  const a = oldGate.evaluateCard(oldBoard, task, { repo });
  const b = newGate.evaluateCard(newBoard, newBoard.taskById.get(task.id), { repo });
  rows.push({
    id: task.id,
    title: task.title,
    assignee: task.assignee,
    old: sig(a),
    new: sig(b),
    oldAdv: a.advisories.map((x) => x.rule),
    newAdv: b.advisories.map((x) => x.rule),
    verdictOld: a.facts.verdict,
    verdictNew: b.facts.verdict,
    discounted: b.facts.discounted_verdicts,
  });
}

const changed = rows.filter((r) => r.old !== r.new);
const newly = changed.filter((r) => r.old === "-" && r.new !== "-");
const cleared = changed.filter((r) => r.old !== "-" && r.new === "-");
const other = changed.filter((r) => r.old !== "-" && r.new !== "-");

console.log(`done cards evaluated: ${rows.length}`);
console.log(`  violations unchanged : ${rows.length - changed.length}`);
console.log(`  newly failing        : ${newly.length}`);
console.log(`  cleared              : ${cleared.length}`);
console.log(`  changed both ways    : ${other.length}`);

const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
for (const [label, list] of [["NEWLY FAILING", newly], ["CLEARED", cleared], ["CHANGED", other]]) {
  if (!list.length) continue;
  console.log(`\n${label}:`);
  for (const r of list) {
    console.log(`  ${pad(r.id, 12)} @${pad(r.assignee, 10)} verdict ${r.verdictOld} → ${r.verdictNew}`);
    console.log(`      old: ${r.old}`);
    console.log(`      new: ${r.new}`);
    const ignoredAuthors = new Map();
    for (const ig of r.discounted.ignored) ignoredAuthors.set(ig.author, (ignoredAuthors.get(ig.author) || 0) + 1);
    if (ignoredAuthors.size) {
      console.log(`      discounted non-QA marker comments: ${[...ignoredAuthors].map(([a, n]) => `${a}×${n}`).join(", ")}`);
    }
    if (r.discounted.self_declared.length) {
      console.log(`      self-declared verdict: ${r.discounted.self_declared.map((s) => `${s.author}(${s.token})`).join(", ")}`);
    }
  }
}

// Advisory delta: A7/A8 may appear on a card that is otherwise unchanged; every
// other advisory rule must be identical between revisions.
const advDelta = rows.filter((r) => {
  const a = [...r.oldAdv].sort().join(",");
  const b = [...r.newAdv].sort().join(",");
  return a !== b;
});
console.log(`\nadvisories changed on ${advDelta.length} card(s):`);
for (const r of advDelta) {
  const added = r.newAdv.filter((x) => !r.oldAdv.includes(x));
  const removed = r.oldAdv.filter((x) => !r.newAdv.includes(x));
  console.log(`  ${pad(r.id, 12)} +${added.join(",") || "-"} -${removed.join(",") || "-"}`);
}

const a7 = rows.filter((r) => r.newAdv.includes("A7_VERDICT_AUTHOR_IGNORED"));
const a8 = rows.filter((r) => r.newAdv.includes("A8_VERDICT_SELF_DECLARED"));
console.log(`\nA7_VERDICT_AUTHOR_IGNORED on ${a7.length} card(s) — the §3 discounting is visible on every audit:`);
for (const r of a7) {
  const n = r.discounted.ignored.length;
  const authors = [...new Set(r.discounted.ignored.map((i) => i.author))].join(", ");
  console.log(`  ${pad(r.id, 12)} ${n} non-QA marker comment(s) by ${authors}`);
}
console.log(`A8_VERDICT_SELF_DECLARED on ${a8.length} card(s):`);
for (const r of a8) console.log(`  ${pad(r.id, 12)} ${r.discounted.self_declared.map((s) => `${s.author}→"${s.token}"`).join(", ")}`);

// The controls the fix must not disturb.
const untouched = rows.filter((r) => r.old === r.new).length;
console.log(`\ncontrol: ${untouched}/${rows.length} cards keep an identical violation set.`);
