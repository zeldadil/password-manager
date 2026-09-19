import fs from "node:fs";
// Pre-flight: what will the gate parse out of each comment body?
const VERDICT_MARKER_RE = /(?:^|[\s(])qa[\s_-]*verdict\s*:\s*([a-z][a-z-]*)/i;
const VERDICT_LOOSE_RE = /verdict\s*[:\-—]+\s*([a-z][a-z-]*)/i;
const DEFERRAL_RE = /qa[\s_-]*verdict\s*[:\-—]+\s*deferred/i;
const EXCEPTION_RE = /qa[\s_-]*signoff[\s_-]*exception\s*[:\-—]+\s*(\S[^\n]*)/i;
const NOTE_FOLLOWUP_RE = /\b(follow[\s-]*up|t_[0-9a-f]{8}|https:\/\/github\.com\/\S+\/(issues|pull)\/\d+)\b/i;
const EVIDENCE_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:actions\/runs\/\d+|pull\/\d+|issues\/\d+)[\w#/?=&.-]*/gi;
const EVIDENCE_MD_LINK_RE = /\]\(([^)\s]+)\)/g;
const EVIDENCE_PATH_RE = /(?:^|[\s`("'[])((?:tests|apps|packages|scripts|docs|architecture|\.github)\/[\w./@-]+\.[a-z0-9]{1,8})(?=[\s`)"'\].,;:]|$)/gim;
const EVIDENCE_ABS_RE = /(?:^|[\s`("'[])(\/[\w./@-]+\.[a-z0-9]{1,8})(?=[\s`)"'\].,;:]|$)/gm;
const EVIDENCE_DIR_RE = /(?:^|[\s`("'[])((?:tests|docs|architecture)\/[\w./-]+\/)(?=[\s`)"'\].,;:]|$)/gm;

for (const f of process.argv.slice(2)) {
  const t = fs.readFileSync(f, "utf8");
  const marker = VERDICT_MARKER_RE.exec(t);
  const loose = VERDICT_LOOSE_RE.exec(t);
  console.log(`=== ${f}`);
  console.log(`  marker token : ${marker ? JSON.stringify(marker[1]) : "NONE"}`);
  console.log(`  loose token  : ${loose ? JSON.stringify(loose[1]) : "NONE"} (only used for qa-authored comments)`);
  console.log(`  deferral     : ${DEFERRAL_RE.test(t) ? "YES — WOULD HIJACK" : "no"}`);
  console.log(`  exception    : ${EXCEPTION_RE.test(t) ? "YES — WOULD SUPPRESS RULES" : "no"}`);
  console.log(`  followup tok : ${NOTE_FOLLOWUP_RE.test(t) ? "yes" : "NO — R6 would fire on pass-with-conditions"}`);
  const paths = [...new Set([...t.matchAll(EVIDENCE_PATH_RE)].map((m) => m[1]))];
  const dirs = [...new Set([...t.matchAll(EVIDENCE_DIR_RE)].map((m) => m[1].replace(/\/$/, "")))];
  const abs = [...new Set([...t.matchAll(EVIDENCE_ABS_RE)].map((m) => m[1]))];
  const urls = [...new Set([...t.matchAll(EVIDENCE_URL_RE)].map((m) => m[0]))];
  const md = [...t.matchAll(EVIDENCE_MD_LINK_RE)].map((m) => m[1]);
  console.log(`  paths  : ${paths.join(" | ") || "-"}`);
  console.log(`  dirs   : ${dirs.join(" | ") || "-"}`);
  console.log(`  abs    : ${abs.join(" | ") || "-"}`);
  console.log(`  urls   : ${urls.join(" | ") || "-"}`);
  console.log(`  mdlinks: ${md.join(" | ") || "-"}`);
}
