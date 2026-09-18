import fs from "node:fs";

const EV = process.env.EVIDENCE_DIR || "/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence";
const tasks = JSON.parse(fs.readFileSync(`${EV}/board-tasks.json`, "utf8"));
const comments = JSON.parse(fs.readFileSync(`${EV}/board-comments.json`, "utf8"));

// --- exactly what the gate under test uses (scripts/qa/signoff-gate.mjs @ 0af4a453) ---
const SECURITY_TRACK_RE =
  /\b(packages\/crypto|crypto[\s-]*(primitive|implementation|boundary|module|package)|KDF|AEAD|Argon2id|vault[\s-]*key|bridge[\s-]*protocol|bridge[\s-]*message|autofill)\b/i;
const TEST_TYPES_RE = /test\s*types\s*:?\**\s*([^\n]+)/i;
const ARCH_SIGNOFF_RE = /(arch[\s_-]*(verdict|sign[\s_-]*off)|approv|signed[\s_-]*off|LGTM)/i;

// --- the classification list derived from ADR-002 §5.2/§5.3 + ADR-005 §3/§4/§5/§9.2 ---
const SCOPE = [
  ["crypto-boundary:packages/crypto", /packages\/crypto|crypto\s*(boundary|module|package|primitive|implementation|wrapper)/i],
  ["crypto-boundary:KDF/Argon2id", /\bKDF\b|Argon2id|argon2\b/i],
  ["crypto-boundary:AEAD/AES-GCM", /\bAEAD\b|AES-?256-?GCM|GCM[ -]?tag/i],
  ["crypto-boundary:nonce/IV", /\bnonce\b|\bIV\b(?=[^a-z])|getRandomValues|randomBytes/i],
  ["crypto-boundary:key-wrapping/vault-key", /key\s*wrapp|vault[\s-]*key|master[\s-]*key|\bsub-?key\b/i],
  ["crypto-boundary:lock/unlock-lifecycle", /lock[\s/-]*(unlock|state|lifecycle)|unlock\s*lifecycle|derive\s*→\s*hold\s*→\s*clear/i],
  ["crypto-boundary:recovery-kit", /recovery\s*(kit|key)/i],
  ["crypto-boundary:backup-export", /(encrypted|encrypt)[\s-]*(backup|export)|backup\s*(export|dump)/i],
  ["bridge-protocol", /bridge[\s-]*(protocol|message|contract|permission)|postMessage|LOCK_STATE_CHANGED|vault[\s-]*session[\s-]*sync/i],
  ["bridge-origin-validation", /origin[\s-]*validation|allowed[\s-]*origin|sender\.origin/i],
  ["bridge-autofill", /\bautofill\b/i],
  ["bridge-shared-contract", /packages\/shared/i],
];

const testTypesOf = (t) => {
  const m = TEST_TYPES_RE.exec(t.body || "");
  return m ? m[1].toLowerCase().trim() : "";
};

const rows = tasks.map((t) => {
  const blob = `${t.title || ""}\n${t.body || ""}`;
  const tt = testTypesOf(t);
  const isQa = String(t.assignee || "").trim() === "qa";
  const gate = SECURITY_TRACK_RE.test(blob) && /security/.test(tt) && !isQa;
  const keywordHit = SECURITY_TRACK_RE.test(blob);
  const hits = SCOPE.filter(([, re]) => re.test(blob)).map(([n]) => n);
  const archSignoff = comments.some(
    (c) => c.task_id === t.id && String(c.author || "").trim() === "architect" && ARCH_SIGNOFF_RE.test(c.body || ""),
  );
  return { t, tt, gate, keywordHit, hits, archSignoff, isQa };
});

const scopeIn = rows.filter((r) => r.hits.length > 0);

console.log("=== R7 classification audit — board of", tasks.length, "cards (all statuses) ===");
console.log();
console.log("A) cards the CURRENT heuristic flags as security-track:", rows.filter((r) => r.gate).length);
for (const r of rows.filter((r) => r.gate)) {
  console.log(`   ${r.t.id} [${r.t.status}] ${r.t.assignee} :: ${r.t.title}`);
  console.log(`      test types: ${r.tt}`);
}
console.log();
console.log("B) cards whose text matches the heuristic KEYWORD but lack a `security` test type (silent R7 no-fire):",
  rows.filter((r) => r.keywordHit && !r.gate && !r.isQa).length);
for (const r of rows.filter((r) => r.keywordHit && !r.gate && !r.isQa)) {
  console.log(`   ${r.t.id} [${r.t.status.padEnd(7)}] ${String(r.t.assignee).padEnd(9)} testTypes="${r.tt}" :: ${r.t.title.slice(0, 72)}`);
}
console.log();
console.log("C) cards in the ADR-002 §5.3 / ADR-005 scope (my list), by status:");
const byStatus = {};
for (const r of scopeIn) byStatus[r.t.status] = (byStatus[r.t.status] || 0) + 1;
console.log("  ", JSON.stringify(byStatus));
console.log();
console.log("   id            status    assignee   heur  ADR-scope hits");
for (const r of scopeIn) {
  console.log(
    `   ${r.t.id}  ${r.t.status.padEnd(8)} ${String(r.t.assignee).padEnd(10)} ${r.gate ? "YES " : "no  "}  ${r.hits.join(", ")}`,
  );
}
console.log();
console.log("D) false negatives = in ADR scope, NOT flagged by the heuristic (excl. qa-assigned):");
const fn = scopeIn.filter((r) => !r.gate && !r.isQa);
console.log("   count:", fn.length);
for (const r of fn) {
  console.log(`   ${r.t.id} [${r.t.status}] ${r.t.assignee} :: ${r.t.title.slice(0, 68)}`);
  console.log(`      scope: ${r.hits.join(", ")} | test types: "${r.tt}"`);
}
console.log();
console.log("E) architect-signoff comment present (heuristic ARCH_SIGNOFF_RE, author=architect):");
for (const r of rows.filter((r) => r.archSignoff)) console.log(`   ${r.t.id} ${r.t.title.slice(0, 64)}`);
