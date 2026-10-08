// t_7e8bf917 — checks every claim §5.9 "How a PR declares a card" makes about
// the linking vocabulary against the real exported functions (no network).
// Usage: node tests/evidence/t_7e8bf917/vocab-probe.mjs
import { declaredCardIds, prCardRelation } from "../../../scripts/qa/signoff-gate.mjs";

const ID = "t_7e8bf917";
const cases = [
  // [description, pr, expected: "link" | "mention" | null]
  ["head branch qa/<id>-x", { headRefName: `qa/${ID}-declarative-pr-link`, body: "" }, "link"],
  ["head branch feature/<id>", { headRefName: `feature/${ID}`, body: "" }, "link"],
  ["Closes <id>", { body: `Closes ${ID}` }, "link"],
  ["Closes: <id> (colon optional)", { body: `Closes: ${ID}` }, "link"],
  ["closes <id> (case-insensitive)", { body: `closes ${ID}` }, "link"],
  ["Card: <id>", { body: `Card: ${ID}` }, "link"],
  ["Card <id> (no colon) is not a declaration", { body: `Card ${ID}` }, "mention"],
  ["Task: <id>", { body: `Task: ${ID}` }, "link"],
  ["Task <id> (no colon) is not a declaration", { body: `Task ${ID}` }, "mention"],
  ["- **Task:** <id>", { body: `- **Task:** ${ID}` }, "link"],
  ["+ Closes <id> (plus bullet)", { body: `+ Closes ${ID}` }, "link"],
  ["   Closes <id> (3 spaces)", { body: `   Closes ${ID}` }, "link"],
  ["Task: t_a (BE-1), <id> (BE-2)", { body: `Task: t_aaaaaaaa (BE-1), ${ID} (BE-2)` }, "link"],
  ["Task: t_a and <id>", { body: `Task: t_aaaaaaaa and ${ID}` }, "link"],
  ["Card: t_a; <id>", { body: `Card: t_aaaaaaaa; ${ID}` }, "link"],
  ["Closes t_a & <id>", { body: `Closes t_aaaaaaaa & ${ID}` }, "link"],
  ["Closes the gap found in <id>", { body: `Closes the gap found in ${ID}.` }, "mention"],
  ["> Closes <id> (block quote)", { body: `> Closes ${ID}` }, "mention"],
  ["fenced Closes <id>", { body: "```\nCloses " + ID + "\n```" }, "mention"],
  ["tilde-fenced Closes <id>", { body: "~~~\nCloses " + ID + "\n~~~" }, "mention"],
  ["inline span `Closes <id>`", { body: "`Closes " + ID + "`" }, "mention"],
  ["indented code block", { body: "text\n\n    Closes " + ID + "\n" }, "mention"],
  ["id in title only", { title: `feat: x (${ID})`, body: "nothing" }, "mention"],
  ["prose mention", { body: `See ${ID} for context.` }, "mention"],
  ["longer id is not the card", { body: `Closes ${ID}9` }, null],
];
let fail = 0;
for (const [desc, pr, want] of cases) {
  const rel = prCardRelation({ title: "", headRefName: "feature/x", ...pr }, ID);
  const got = rel ? (rel.link ? "link" : "mention") : null;
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${desc} → ${got}${ok ? "" : ` (want ${want})`}`);
}
console.log(`declaredCardIds sample: ${JSON.stringify([...declaredCardIds(`- **Task:** t_aaaaaaaa (BE-1), **${ID}** (BE-2)`)])}`);
console.log(`\n${cases.length - fail}/${cases.length} vocabulary claims hold`);
process.exit(fail ? 1 : 0);
