// t_9ae2bc23 — criterion 1 helper: does the R7 regex shipped on a gate revision
// match the identifiers the ADRs use? Reads SECURITY_TRACK_RE from the file as
// text (importing the gate would run its CLI). Usage: node r7-probe.mjs <gate.mjs>
import { readFileSync } from "node:fs";

const src = readFileSync(process.argv[2], "utf8");
const m = src.match(/const SECURITY_TRACK_RE =\s*\/(.+)\/([a-z]*);/);
if (!m) { console.error("SECURITY_TRACK_RE not found"); process.exit(2); }
const re = new RegExp(m[1], m[2]);
console.log(`SECURITY_TRACK_RE = /${m[1]}/${m[2]}`);
const probes = [
  ["autofill", "control: bare word"],
  ["AUTOFILL_REQUEST", "ADR-005 §2.1 message name"],
  ["AUTOFILL_RESPONSE", "ADR-005 §2.1 message name"],
  ["vault key", "control: spaced"],
  ["vaultKey", "ADR-002 §5.2/§5.3 identifier"],
  ["nonce reuse", "ADR-002 §5.3 Decision 4"],
  ["sender.origin validation", "ADR-005 §3 / §9.3"],
  ["AES-256-GCM", "ADR-002 §5.3 Decision 2"],
];
for (const [s, why] of probes) console.log(`${re.test(s) ? "MATCH   " : "no match"}  ${JSON.stringify(s)}  (${why})`);
