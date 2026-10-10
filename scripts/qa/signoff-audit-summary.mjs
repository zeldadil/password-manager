#!/usr/bin/env node
/**
 * signoff-audit-summary.mjs — surface the audit's "bypasses and degradations"
 * block in GitHub Actions (t_b102b100, QA_SIGN_OFF_GATE.md §5.9 / §6).
 *
 * Reads the document `signoff-gate.mjs audit --json-out FILE` wrote and:
 *
 *   - appends a "Bypasses and degradations" section to the run summary
 *     (`$GITHUB_STEP_SUMMARY`, or `--summary-out FILE`): one counter row per
 *     type (A11; the bypasses X1 exception in force, X2 exception withdrawn,
 *     X3 completed outside the hook — t_5b5b61e2), a trend table (last 30 days
 *     vs the previous 30, per month, watch threshold) for the bypass types, then
 *     one table per non-empty type: per card for A11, per OCCURRENCE (date,
 *     card, title, author, reason, state) for the bypasses. The gate emits every
 *     type in `degradations[]`; this script renders whatever it gets. A type the
 *     audit could not read (`available: false`) is shown as "not available",
 *     never as 0;
 *   - prints workflow commands on stdout: one `::warning::` per A11 card and per
 *     X1 exception, one `::notice::` per non-empty X2/X3 type (they can be
 *     numerous; GitHub keeps only the first annotations of a step), and one
 *     `::warning::` per bypass type above its watch threshold.
 *
 * Free text (reasons, titles, authors) is untrusted: it reaches this script
 * through the JSON document (never through a shell), is already passed
 * through the secret scanner by the gate (AR-2), and is Markdown-escaped here
 * (`untrusted`) and workflow-command-escaped in annotations.
 *
 * It never decides the run's colour: that is the audit's exit code
 * (`--fail-on-a11`). Exit 0 = section written (including the "JSON missing /
 * no degradations block" cases, which are reported, never shown as 0) ·
 * 3 = unreadable JSON / no summary path / bad usage.
 *
 * Usage:
 *   node scripts/qa/signoff-audit-summary.mjs --json FILE [--summary-out FILE]
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const HEADING = "### Bypasses and degradations";

/** Workflow-command escaping (actions/toolkit `escapeData` / `escapeProperty`). */
export function escapeData(s) {
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
export function escapeProperty(s) {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/** One Markdown table cell: no pipe, no newline, no HTML. */
function cell(s) {
  return String(s ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Markdown "not available" section + its warning — never a reassuring 0. */
export function renderUnavailable(reason) {
  return {
    summary: `${HEADING}: not available\n\n${cell(reason)}. Bypasses and degradations (A11, …) could not be counted.\n\n`,
    annotations: [`::warning title=${escapeProperty("Bypasses and degradations not available")}::${escapeData(reason)}`],
  };
}

/**
 * A cell holding free text written by agents or humans (exception / override
 * reasons, card titles, authors — t_5b5b61e2): on top of `cell`, Markdown
 * syntax is backslash-escaped so a reason can neither inject a link, an image
 * (a tracking pixel in the run summary), code spans nor emphasis.
 */
function untrusted(s) {
  // Markdown escape first, THEN `cell`: escaping after `cell` would double the
  // backslash of its `\|` and turn the pipe back into a column separator.
  return cell(String(s ?? "").replace(/([\\`*_[\]()!~#])/g, "\\$1"));
}

/** `2026-10-05 20:36 UTC` for an epoch-seconds board timestamp. */
function day(at) {
  const n = Number(at);
  if (at === null || at === undefined || !Number.isFinite(n) || n <= 0) return "date unknown";
  return `${new Date(n * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** `{ summary, annotations }` for an audit document. */
export function renderDegradations(doc) {
  const block = doc && Array.isArray(doc.degradations) ? doc.degradations : null;
  if (!block) return renderUnavailable("the audit document has no `degradations` block (gate older than t_b102b100?)");
  const lines = [HEADING, ""];
  lines.push("Counted on every audit. A degradation is **never** a card violation; it says what this audit could not check or what was waived.");
  lines.push("A bypass (`X1`/`X2`/`X3`) **never** fails the audit: it is listed here so it stays visible (t_5b5b61e2, QA_SIGN_OFF_GATE.md §5.10).");
  lines.push("");
  lines.push("| type | count | fails this audit? | cards |");
  lines.push("|---|---|---|---|");
  const annotations = [];
  for (const d of block) {
    const ids = Array.isArray(d.task_ids) ? d.task_ids : [];
    if (d.available === false) {
      lines.push(`| \`${cell(d.rule || d.key)}\` — ${cell(d.label)} | **not available** | never | ${cell(d.unavailable_reason || "not readable on this board")} |`);
      annotations.push(`::warning title=${escapeProperty(`${d.annotation || d.key}: not available`)}::${escapeData(d.unavailable_reason || "not readable on this board")}`);
      continue;
    }
    const fails = d.fail_flag
      ? d.fail_flag_on
        ? d.fails_audit
          ? `**yes — red** (\`${cell(d.fail_flag)}\`)`
          : `no (\`${cell(d.fail_flag)}\` on, count 0)`
        : `no (\`${cell(d.fail_flag)}\` off)`
      : "never";
    const count = d.occurrences !== undefined ? `${Number(d.count) || 0} (${Number(d.occurrences) || 0} occurrence${Number(d.occurrences) === 1 ? "" : "s"})` : `${Number(d.count) || 0}`;
    lines.push(`| \`${cell(d.rule || d.key)}\` — ${cell(d.label)} | ${count} | ${fails} | ${ids.length ? ids.map((id) => `\`${cell(id)}\``).join(", ") : "—"} |`);
  }
  // Trend + watch threshold of the bypass types (criterion 3 of t_5b5b61e2): a
  // threshold is a prompt to look, never a red run.
  const trended = block.filter((d) => d.available !== false && d.trend);
  if (trended.length) {
    lines.push("");
    lines.push(`Trend as of ${cell(trended[0].trend.as_of)} (30-day windows):`);
    lines.push("");
    lines.push("| type | last 30 days | previous 30 days | direction | watch threshold (30 days) | by month |");
    lines.push("|---|---|---|---|---|---|");
    for (const d of trended) {
      const t = d.trend;
      const months = Object.entries(t.by_month || {}).map(([m, n]) => `${cell(m)}: ${Number(n) || 0}`).join(", ") || "—";
      const watch = t.watch_threshold_30d === null || t.watch_threshold_30d === undefined ? "—" : `${t.watch_threshold_30d}: ${t.above_watch ? "**above — review**" : "below"}`;
      lines.push(`| \`${cell(d.rule || d.key)}\` | ${Number(t.last_30d) || 0} | ${Number(t.previous_30d) || 0} | ${cell(t.direction)} | ${watch} | ${months} |`);
      if (t.above_watch) {
        annotations.push(
          `::warning title=${escapeProperty(`${d.annotation || d.key}: above watch threshold`)}::${escapeData(`${t.last_30d} in the last 30 days (threshold ${t.watch_threshold_30d}, previous 30 days ${t.previous_30d}) — review them in the run summary; this never fails the audit`)}`,
        );
      }
    }
  }
  for (const d of block) {
    if (d.available === false) continue;
    const cards = Array.isArray(d.cards) ? d.cards : [];
    if (Number(d.count) !== cards.length) {
      lines.push("");
      lines.push(`> **Inconsistent audit document:** \`${cell(d.key)}\` count = ${cell(d.count)} but ${cards.length} card(s) listed.`);
    }
    if (!cards.length) continue;
    const hasRecords = cards.some((c) => Array.isArray(c.records));
    if (hasRecords) {
      // One row per occurrence, oldest first: card, author, reason, date —
      // readable without opening the board (criterion 1/2 of t_5b5b61e2).
      const rows = cards.flatMap((c) => (Array.isArray(c.records) ? c.records : []).map((x) => ({ c, x })));
      rows.sort((a, b) => (Number(a.x.at) || 0) - (Number(b.x.at) || 0) || String(a.c.task_id).localeCompare(String(b.c.task_id)));
      if (d.occurrences !== undefined && Number(d.occurrences) !== rows.length) {
        lines.push("");
        lines.push(`> **Inconsistent audit document:** \`${cell(d.key)}\` occurrences = ${cell(d.occurrences)} but ${rows.length} listed.`);
      }
      lines.push("");
      lines.push(`#### \`${cell(d.rule || d.key)}\`: ${rows.length} occurrence${rows.length === 1 ? "" : "s"} on ${cards.length} card${cards.length === 1 ? "" : "s"}`);
      lines.push("");
      lines.push("| date | card | title | author | reason | state |");
      lines.push("|---|---|---|---|---|---|");
      for (const { c, x } of rows) {
        lines.push(`| ${day(x.at)} | \`${cell(c.task_id)}\` | ${untrusted(c.title)} | ${untrusted(x.author)} | ${untrusted(x.reason)} | ${untrusted(x.state)} |`);
        if (d.annotate === "per-record") {
          annotations.push(`::warning title=${escapeProperty(`${d.annotation || d.key}: ${c.task_id}`)}::${escapeData(`${c.task_id} ${c.title || ""} — ${day(x.at)} · ${x.author} · ${x.reason || "(no reason)"}`)}`);
        }
      }
      if (d.annotate === "aggregate") {
        annotations.push(`::notice title=${escapeProperty(`${d.annotation || d.key}: ${rows.length}`)}::${escapeData(`${rows.length} occurrence(s) on ${cards.length} card(s) — listed in the run summary`)}`);
      }
      continue;
    }
    lines.push("");
    lines.push(`#### \`${cell(d.rule || d.key)}\`: ${cards.length}`);
    lines.push("");
    lines.push("| card | title | detail |");
    lines.push("|---|---|---|");
    for (const c of cards) {
      lines.push(`| \`${cell(c.task_id)}\` | ${cell(c.title)} | ${cell(c.detail)} |`);
      annotations.push(`::warning title=${escapeProperty(`${d.annotation || d.key}: ${c.task_id}`)}::${escapeData(`${c.task_id} ${c.title || ""} — ${c.detail}`)}`);
    }
  }
  lines.push("");
  return { summary: `${lines.join("\n")}\n`, annotations };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[argv[i].slice(2)] = true;
      else {
        args[argv[i].slice(2)] = next;
        i++;
      }
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summaryPath = typeof args["summary-out"] === "string" ? args["summary-out"] : process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    console.error("signoff-audit-summary: no summary path (--summary-out FILE or $GITHUB_STEP_SUMMARY)");
    process.exit(3);
  }
  if (typeof args.json !== "string") {
    console.error("signoff-audit-summary: --json FILE is required");
    process.exit(3);
  }
  let out;
  if (!existsSync(args.json)) {
    // The audit did not run, or died before writing its document: say so.
    out = renderUnavailable(`no audit JSON at ${args.json}`);
  } else {
    let doc;
    try {
      doc = JSON.parse(readFileSync(args.json, "utf8"));
    } catch (e) {
      console.error(`signoff-audit-summary: unreadable audit JSON ${args.json}: ${e.message}`);
      process.exit(3);
    }
    out = renderDegradations(doc);
  }
  appendFileSync(summaryPath, out.summary);
  for (const a of out.annotations) console.log(a);
  process.exit(0);
}

const invoked = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (invoked) main();
