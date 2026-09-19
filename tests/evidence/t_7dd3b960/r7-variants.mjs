import fs from "node:fs";
const EV = process.env.EVIDENCE_DIR || "/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence";
const tasks = JSON.parse(fs.readFileSync(`${EV}/board-tasks.json`, "utf8"));

const TEST_TYPES_RE = /test\s*types\s*:?\**\s*([^\n]+)/i;
const tt = (t) => { const m = TEST_TYPES_RE.exec(t.body || ""); return m ? m[1].toLowerCase().trim() : ""; };
const isQa = (t) => String(t.assignee || "").trim() === "qa";
const blob = (t) => `${t.title || ""}\n${t.body || ""}`;

// v1 — exactly what the gate ships today
const V1 = /\b(packages\/crypto|crypto[\s-]*(primitive|implementation|boundary|module|package)|KDF|AEAD|Argon2id|vault[\s-]*key|bridge[\s-]*protocol|bridge[\s-]*message|autofill)\b/i;

// v2 — v1 + the boundary items ADR-002 §5.3 / ADR-005 §3/§4/§5/§9.2 name and v1 misses
const V2 = new RegExp(
  [
    V1.source.replace(/^\\b\(|\)\\b$/g, ""),
    "AES-?256-?GCM",
    "GCM[\\s-]*tag",
    "\\bnonce\\b",
    "\\bIV\\b",
    "key[\\s-]*wrapp",
    "vaultKey",
    "master[\\s-]*key",
    "recovery[\\s-]*(kit|key)",
    "(encrypted|encrypt)[\\s-]*(backup|export)|backup[\\s-]*(export|dump)",
    "packages/shared",
    "origin[\\s-]*validation",
    "allowed[\\s-]*origin",
    "postMessage",
    "LOCK_STATE_CHANGED",
    "vault[\\s-]*session[\\s-]*sync",
    "crypto\\.subtle",
    "node:crypto",
    "AUTOFILL_[A-Z]+",
    "lock[/-]unlock",
  ].join("|"),
  "i",
);

const variants = {
  "v1 (shipped): keyword AND security-Test-Type, non-QA":
    (t) => V1.test(blob(t)) && /security/.test(tt(t)) && !isQa(t),
  "v2a (option A): keyword AND security-Test-Type, non-QA  [no change]":
    (t) => V1.test(blob(t)) && /security/.test(tt(t)) && !isQa(t),
  "v2b (option B): keyword OR security-Test-Type, non-QA":
    (t) => (V1.test(blob(t)) || /security/.test(tt(t))) && !isQa(t),
  "v2c (option C): scope-v2 regex alone, non-QA":
    (t) => V2.test(blob(t)) && !isQa(t),
  "v2d (option D): scope-v2 AND security-Test-Type, non-QA":
    (t) => V2.test(blob(t)) && /security/.test(tt(t)) && !isQa(t),
};

const v1set = new Set(tasks.filter(variants["v1 (shipped): keyword AND security-Test-Type, non-QA"]).map((t) => t.id));

for (const [name, fn] of Object.entries(variants)) {
  const hit = tasks.filter(fn);
  const added = hit.filter((t) => !v1set.has(t.id));
  const removed = tasks.filter((t) => v1set.has(t.id) && !fn(t));
  console.log(`${name}\n    cards flagged: ${hit.length}   newly flagged vs shipped: ${added.length}   dropped: ${removed.length}`);
  if (added.length) console.log(`    newly flagged: ${added.map((t) => `${t.id}(${t.status})`).join(" ")}`);
  if (removed.length) console.log(`    dropped: ${removed.map((t) => t.id).join(" ")}`);
  console.log();
}

console.log("=== who is exempt today (qa-assigned cards matching the keyword) ===");
for (const t of tasks.filter((t) => isQa(t) && V1.test(blob(t)))) console.log(`   ${t.id} ${t.status} :: ${t.title.slice(0, 60)}`);
