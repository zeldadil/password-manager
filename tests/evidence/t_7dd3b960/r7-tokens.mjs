import fs from "node:fs";

const EV = process.env.EVIDENCE_DIR || "/home/sap/.hermes/kanban/workspaces/t_7dd3b960/evidence";
const tasks = JSON.parse(fs.readFileSync(`${EV}/board-tasks.json`, "utf8"));
const byId = new Map(tasks.map((t) => [t.id, t]));

const TOKENS = [
  "vaultKey", "vault_key", "vault key", "masterKey", "master key",
  "AES-256-GCM", "AES-GCM", "AEAD", "Argon2id", "argon2", "KDF",
  "nonce", "key wrapping", "wrap", "GCM tag", "authentication tag",
  "recovery kit", "recovery key", "backup", "export",
  "packages/shared", "packages/crypto", "origin validation", "allowed origin",
  "postMessage", "autofill", "bridge protocol", "bridge message", "crypto.subtle", "node:crypto",
];

const FN = [
  "t_16f8ad84", "t_4d0c8439", "t_91964616", "t_fe3b76ea", "t_b51bf4b9", "t_e4341d18",
  "t_1f98942a", "t_e5142129", "t_4f42e589", "t_83dc1b35", "t_979847fc", "t_8e4c8bfa",
  "t_4278a1dc", "t_974b5e77", "t_b1a8b77e", "t_7b33595a", "t_c7258993", "t_acd800fe", "t_9840ccdd",
];

console.log("Token presence in card title+body (which literal strings the R7 regex has / lacks)");
console.log();
for (const id of FN) {
  const t = byId.get(id);
  if (!t) { console.log(`${id}: NOT ON BOARD`); continue; }
  const blob = `${t.title || ""}\n${t.body || ""}`;
  const present = TOKENS.filter((tok) => new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(blob));
  console.log(`${id}  ${t.title.slice(0, 58)}`);
  console.log(`      test types: "${(/(?:test\s*types\s*:?\**\s*([^\n]+))/i.exec(t.body || "") || [])[1] || ""}"`);
  console.log(`      tokens present: ${present.join(" | ") || "(none)"}`);
}

// Which literal tokens would the strict regex catch?  hasKeyword = the regex's own tokens
const STRICT = /packages\/crypto|crypto[\s-]*(primitive|implementation|boundary|module|package)|\bKDF\b|\bAEAD\b|Argon2id|vault[\s-]*key|bridge[\s-]*protocol|bridge[\s-]*message|\bautofill\b/i;
console.log();
console.log("=== per-card: strict-regex keyword hit, and which missing token would have caught it ===");
for (const id of FN) {
  const t = byId.get(id);
  if (!t) continue;
  const blob = `${t.title || ""}\n${t.body || ""}`;
  const hit = STRICT.test(blob);
  console.log(`${id}\tstrictKeyword=${hit ? "HIT" : "miss"}\t${t.status}\t${t.title.slice(0, 52)}`);
}
