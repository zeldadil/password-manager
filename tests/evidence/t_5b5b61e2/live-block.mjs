#!/usr/bin/env node
// t_5b5b61e2 — the live-board bypass block, for a PUBLIC repo: every occurrence
// with card, date, author and state, but the free-text reason replaced by its
// length (the reasons are on the board; the audit prints them on the trusted
// runner — this committed file does not need to). Counts and trend unchanged.
// Usage: node live-block.mjs branch-audit.json
import { readFileSync } from "node:fs";

const doc = JSON.parse(readFileSync(process.argv[2], "utf8"));
const day = (at) => (Number(at) > 0 ? `${new Date(Number(at) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "date unknown");
console.log(`counts: ${JSON.stringify(doc.counts)}`);
for (const d of doc.degradations) {
  if (d.available === false) {
    console.log(`${d.rule}: not available — ${d.unavailable_reason}`);
    continue;
  }
  console.log(`\n${d.rule}: ${d.count} card(s)${d.occurrences !== undefined ? `, ${d.occurrences} occurrence(s)` : ""}`);
  if (d.trend) {
    console.log(`  trend as of ${d.trend.as_of}: last 30 days ${d.trend.last_30d}, previous 30 days ${d.trend.previous_30d} (${d.trend.direction}), watch threshold ${d.trend.watch_threshold_30d}: ${d.trend.above_watch ? "ABOVE" : "below"}, by month ${JSON.stringify(d.trend.by_month)}`);
  }
  const rows = d.cards.flatMap((c) => (c.records || []).map((x) => ({ id: c.task_id, ...x })));
  rows.sort((p, q) => (Number(p.at) || 0) - (Number(q.at) || 0) || p.id.localeCompare(q.id));
  if (rows.length) for (const x of rows) console.log(`  ${x.id}  ${day(x.at)}  ${x.author}  <reason: ${String(x.reason || "").length} chars>  [${x.state}]`);
  else if (d.cards.length) console.log(`  cards: ${d.task_ids.join(", ")}`);
}
