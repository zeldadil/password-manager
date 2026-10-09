#!/usr/bin/env node
/**
 * signoff-audit-summary.mjs — surface the audit's "bypasses and degradations"
 * block in GitHub Actions (t_b102b100, QA_SIGN_OFF_GATE.md §5.9 / §6).
 *
 * Reads the document `signoff-gate.mjs audit --json-out FILE` wrote and:
 *
 *   - appends a "Bypasses and degradations" section to the run summary
 *     (`$GITHUB_STEP_SUMMARY`, or `--summary-out FILE`): one counter row per
 *     type (A11 today; t_5b5b61e2 adds exceptions and CLI bypasses — the gate
 *     emits them in `degradations[]`, this script renders every entry it gets,
 *     so adding a type needs no change here), then one table per non-empty type
 *     listing its cards;
 *   - prints one `::warning::` workflow command per card per type on stdout,
 *     so each card is an annotation on the run.
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

/** `{ summary, annotations }` for an audit document. */
export function renderDegradations(doc) {
  const block = doc && Array.isArray(doc.degradations) ? doc.degradations : null;
  if (!block) return renderUnavailable("the audit document has no `degradations` block (gate older than t_b102b100?)");
  const lines = [HEADING, ""];
  lines.push("Counted on every audit. A degradation is **never** a card violation; it says what this audit could not check or what was waived.");
  lines.push("");
  lines.push("| type | count | fails this audit? | cards |");
  lines.push("|---|---|---|---|");
  const annotations = [];
  for (const d of block) {
    const ids = Array.isArray(d.task_ids) ? d.task_ids : [];
    const fails = d.fail_flag
      ? d.fail_flag_on
        ? d.fails_audit
          ? `**yes — red** (\`${cell(d.fail_flag)}\`)`
          : `no (\`${cell(d.fail_flag)}\` on, count 0)`
        : `no (\`${cell(d.fail_flag)}\` off)`
      : "never";
    lines.push(`| \`${cell(d.rule || d.key)}\` — ${cell(d.label)} | ${Number(d.count) || 0} | ${fails} | ${ids.length ? ids.map((id) => `\`${cell(id)}\``).join(", ") : "—"} |`);
  }
  for (const d of block) {
    const cards = Array.isArray(d.cards) ? d.cards : [];
    if (Number(d.count) !== cards.length) {
      lines.push("");
      lines.push(`> **Inconsistent audit document:** \`${cell(d.key)}\` count = ${cell(d.count)} but ${cards.length} card(s) listed.`);
    }
    if (!cards.length) continue;
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
