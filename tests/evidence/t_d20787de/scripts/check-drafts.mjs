#!/usr/bin/env node
/**
 * t_d20787de — pre-post guard for the drafted verdict comments.
 * Applies the gate's own four regexes + its evidence-pointer extraction to each draft, so a draft can
 * never surprise the audit (an accidental marker/loose/deferral/exception match, or a claimed path
 * that does not exist on any ref). Read-only.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const MARKER = /(?:^|[\s(])qa[\s_-]*verdict\s*:\s*([a-z][a-z-]*)/i;
const LOOSE = /verdict\s*[:.\-—]+\s*([a-z][a-z-]*)/i;
const DEFERRAL = /(?:^|[\s(])qa[\s_-]*verdict\s*[:.\-—]+\s*deferred/i;
const EXCEPTION = /qa[\s_-]*signoff[\s_-]*exception\s*[:.\-—]+\s*(\S[^\n]*)/i;
const LABEL = /(?:^|[\w])(?:evidence|artifacts?|attachments?)[ \t]*(?::|—|–)/gi;
const PATH_RE = /(?:^|[\s`("'[])((?:tests|apps|packages|scripts|docs|architecture|\.github)\/[\w.\/@-]+\.[a-z0-9]{1,8})(?=[\s`)"'\].;:]|$)/gim;
const DIR_RE = /(?:^|[\s`("'[])((?:tests|docs|architecture)\/[\w./-]+\/)(?=[\s`)"'\].;:]|$)/gm;
const URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:actions\/runs\/\d+|pull\/\d+|issues\/\d+)[\w#/?=&.-]*/gi;
const VERDICTS = new Set(["pass", "pass-with-conditions", "fail", "blocked"]);

const REPO = "/home/sap/password-manager-check/.worktrees/t_d20787de";
const DIR = "/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch/drafts";

const codeRanges = (text) => {
  const ranges = [];
  let offset = 0;
  let fence = null;
  for (const line of text.split("\n")) {
    const start = offset;
    const m = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) fence = { start, token: m[1][0] };
      else if (m[1][0] === fence.token) {
        ranges.push([fence.start, start + line.length]);
        fence = null;
      }
    }
    offset = start + line.length + 1;
  }
  if (fence) ranges.push([fence.start, text.length]);
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "`") continue;
    let n = 0;
    while (text[i + n] === "`") n++;
    const close = text.indexOf("`".repeat(n), i + n);
    if (close === -1) continue;
    ranges.push([i, close + n]);
    i = close + n - 1;
  }
  return ranges;
};
const inside = (i, ranges) => ranges.some(([a, b]) => i >= a && i < b);
const labelRegions = (text, ranges) => {
  const out = [];
  for (const m of text.matchAll(LABEL)) {
    if (inside(m.index, ranges)) continue;
    const start = m.index + m[0].length;
    const stop = text.slice(start).search(/\n[ \t]*\n|\n#{1,6}[ \t]|\n[ \t]*\|/);
    out.push([start, stop === -1 ? text.length : start + stop]);
  }
  return out;
};
const onAnyRef = (p) => {
  try {
    return execFileSync("git", ["-C", REPO, "rev-list", "--max-count=1", "--all", "--", p], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
};

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md")).sort()) {
  const text = readFileSync(`${DIR}/${f}`, "utf8");
  const ranges = codeRanges(text);
  const labels = labelRegions(text, ranges);
  console.log(`\n===== ${f} =====`);
  const mk = MARKER.exec(text);
  const lo = LOOSE.exec(text);
  console.log(`  marker: ${mk ? JSON.stringify(mk[1]) + (VERDICTS.has(mk[1].toLowerCase()) ? " (VALID token)" : " (INVALID token!)") : "-"}`);
  console.log(`  loose : ${lo ? JSON.stringify(lo[0]) + (VERDICTS.has(lo[1].toLowerCase()) ? " (VALID)" : " (INVALID → would be R2 if no marker)") : "-"}`);
  console.log(`  deferral marker: ${DEFERRAL.test(text)}   exception marker: ${EXCEPTION.test(text)}`);
  console.log(`  verdict record the gate will read: ${mk ? JSON.stringify(mk[1].toLowerCase()) : lo ? `loose ${JSON.stringify(lo[1].toLowerCase())}` : "none"}`);
  const pointers = [];
  const push = (kind, value, idx) => {
    const scopeAt = labels.length ? (inside(idx, labels) ? "claim" : "citation") : inside(idx, ranges) ? "citation" : "claim";
    if (pointers.some((p) => p.kind === kind && p.value === value)) return;
    pointers.push({ kind, value, scope: scopeAt });
  };
  for (const m of text.matchAll(URL_RE)) push("url", m[0], m.index);
  for (const m of text.matchAll(PATH_RE)) push("path", m[1], m.index + m[0].length - m[1].length);
  for (const m of text.matchAll(DIR_RE)) push("dir", m[1].replace(/\/$/, ""), m.index + m[0].length - m[1].length);
  console.log(`  evidence pointers (${pointers.length}):`);
  for (const p of pointers) {
    if (p.kind === "url") { console.log(`    [url ]; ${p.value}`); continue; }
    const inTree = existsSync(`${REPO}/${p.value}`);
    const ref = inTree ? null : onAnyRef(p.value);
    const state = inTree ? "in-checkout" : ref ? `on-ref ${ref.slice(0, 7)}` : "MISSING (would fail R5 if claimed)";
    console.log(`    [${p.kind.padEnd(4)}] ${p.scope.padEnd(8)} ${state.padEnd(28)} ${p.value}`);
  }
  const claims = pointers.filter((p) => p.scope === "claim" && p.kind !== "url");
  const bad = claims.filter((p) => !existsSync(`${REPO}/${p.value}`) && !onAnyRef(p.value));
  console.log(`  claimed non-url pointers: ${claims.length}  unverifiable: ${bad.length}`);
}
console.log("\n(done)");
