#!/usr/bin/env bash
# t_dbecf24d — criterion 3 probe: does the board audit COUNT and LIST A11_CI_STATE_UNVERIFIABLE?
# Runs the master gate's `audit` on a read-only snapshot of the live board, GitHub live and GitHub off.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
SCRATCH="${TMPDIR:-/home/sap/.hermes/profiles/qa/cache/scratch}/t_dbecf24d-audit"
mkdir -p "${SCRATCH}" "${HERE}/audit"
DB="${SCRATCH}/board-snapshot.db"
sqlite3 /home/sap/.hermes/kanban.db ".backup '${DB}'"
G="${REPO}/scripts/qa/signoff-gate.mjs"
for mode in live off; do
  envset=(); [ "${mode}" = off ] && envset=(QA_GATE_GITHUB=off)
  env "${envset[@]}" node "${G}" audit --repo "${REPO}" --db "${DB}" > "${HERE}/audit/audit-github-${mode}.txt" 2>&1
  echo "exit=$?" >> "${HERE}/audit/audit-github-${mode}.txt"
  env "${envset[@]}" node "${G}" audit --repo "${REPO}" --db "${DB}" --json > "${SCRATCH}/audit-${mode}.json" 2>/dev/null
  node --input-type=module -e '
    import fs from "node:fs";
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const a11 = j.results.filter((r) => r.advisories.some((a) => a.rule === "A11_CI_STATE_UNVERIFIABLE"));
    const out = {
      github: process.argv[2],
      counts_keys: Object.keys(j.counts),
      counts: j.counts,
      has_a11_counter: Object.keys(j.counts).some((k) => /a11|unverif/i.test(k)),
      a11_cards: a11.map((r) => r.facts.task_id),
      a11_total: a11.length,
    };
    console.log(JSON.stringify(out, null, 2));
  ' "${SCRATCH}/audit-${mode}.json" "${mode}" > "${HERE}/audit/a11-summary-github-${mode}.json"
  echo "== github ${mode}: text A11 lines=$(grep -c 'A11_CI_STATE_UNVERIFIABLE' "${HERE}/audit/audit-github-${mode}.txt")  header: $(sed -n 2p "${HERE}/audit/audit-github-${mode}.txt")  $(tail -1 "${HERE}/audit/audit-github-${mode}.txt")"
  cat "${HERE}/audit/a11-summary-github-${mode}.json"
done
sed -i "s#${DB}#<board-snapshot>#g; s#${REPO}#<repo>#g" "${HERE}"/audit/*.txt
