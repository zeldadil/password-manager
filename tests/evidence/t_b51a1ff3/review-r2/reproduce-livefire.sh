#!/usr/bin/env bash
# QA round-2 live-fire reproduction for t_b51a1ff3.
# Runs `hermes hooks test` against synthetic payload fixtures kept OUTSIDE the repo.
set -u
cd /tmp/qa-verify-b51a1ff3-C6E4/repo || exit 1
F=/tmp/qa-b51a1ff3-fixtures

echo "###### profile hooks list (qa) ######"
hermes hooks list 2>&1 | grep -iE "secret-guard|signoff|matcher|allowlist|allowed|✗|✓" | head -20

run_case () {
  name="$1"; tool="$2"; file="$3"
  echo ""
  echo "###### CASE $name (tool=$tool, payload=$file) ######"
  hermes hooks test pre_tool_call --for-tool "$tool" --payload-file "$F/$file" > /tmp/qa-b51a1ff3-fixtures/out-$name.txt 2>&1
  echo "hermes_exit=$?"
  grep -E "exit=|action|stdout:|error" /tmp/qa-b51a1ff3-fixtures/out-$name.txt | head -6
}

run_case block-comment          kanban_comment  block-comment.json
run_case block-complete-result  kanban_complete block-complete-result.json
run_case allow-comment          kanban_comment  allow-comment.json
run_case allow-complete         kanban_complete allow-complete.json
