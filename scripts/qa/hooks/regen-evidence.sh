#!/usr/bin/env bash
# Regenerate live-fire.txt and selftest-output.txt evidence for t_b51a1ff3.
# Run from repo root: bash scripts/qa/hooks/regen-evidence.sh
set -uo pipefail  # NOTE: no -e — check-mode exits 1 on purpose

EVIDENCE_DIR="tests/evidence/t_b51a1ff3"
mkdir -p "${EVIDENCE_DIR}"

echo "==> Writing live-fire.txt"
BAD_PAYLOAD=$(mktemp)
GOOD_PAYLOAD=$(mktemp)
SYNTH="12345678:$(printf 'A%.0s' {1..35})"
cat > "${BAD_PAYLOAD}" <<HERMES_EOF
{"hook_event_name":"pre_tool_call","tool_name":"kanban_comment","args":{"task_id":"t_b0000001","body":"deployment done — bot token ${SYNTH} is live"},"session_id":"sess_evidence","cwd":"/tmp","profile":"backend"}
HERMES_EOF
cat > "${GOOD_PAYLOAD}" <<HERMES_EOF
{"hook_event_name":"pre_tool_call","tool_name":"kanban_comment","args":{"task_id":"t_b0000000","body":"deployment successful — no issues"},"session_id":"sess_evidence","cwd":"/tmp","profile":"backend"}
HERMES_EOF

{
  echo "# Live-fire evidence — hermes hooks test (architect profile)"
  echo "# Block case: kanban_comment with a Telegram bot token shape -> action:block"
  echo "# Allow case: kanban_comment with clean body -> {} (no dispatcher contribution)"
  echo "# Fixture token: ${SYNTH:0:12}… (synthetic, shape-matching only — NOT a real credential)"
  echo ""
  echo "## Block case"
  HERMES_HOME=/home/sap/.hermes/profiles/architect \
    HERMES_KANBAN_DB=/tmp/password-manager-check \
    hermes hooks test pre_tool_call --for-tool kanban_comment --payload-file "${BAD_PAYLOAD}" 2>&1 || true
  echo ""
  echo "## Allow case"
  HERMES_HOME=/home/sap/.hermes/profiles/architect \
    HERMES_KANBAN_DB=/tmp/password-manager-check \
    hermes hooks test pre_tool_call --for-tool kanban_comment --payload-file "${GOOD_PAYLOAD}" 2>&1 || true
  echo ""
  echo "## Direct hook invocation (selftest equivalent)"
  echo "# Block: echo token text | node scripts/qa/secret-guard.mjs check"
  echo "${SYNTH}" | node scripts/qa/secret-guard.mjs check 2>&1; echo "exit=$?"
  echo "# Allow: echo clean text | node scripts/qa/secret-guard.mjs check"
  echo "hello world clean" | node scripts/qa/secret-guard.mjs check 2>&1; echo "exit=$?"
} > "${EVIDENCE_DIR}/live-fire.txt"

rm -f "${BAD_PAYLOAD}" "${GOOD_PAYLOAD}"

echo "==> Writing selftest-output.txt"
node scripts/qa/secret-guard.selftest.mjs > "${EVIDENCE_DIR}/selftest-output.txt" 2>&1 || true

echo ""
echo "==> Evidence files written:"
ls -la "${EVIDENCE_DIR}/"
echo ""
echo "==> Selftest summary:"
tail -3 "${EVIDENCE_DIR}/selftest-output.txt"
