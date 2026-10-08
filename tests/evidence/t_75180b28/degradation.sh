#!/usr/bin/env bash
# t_75180b28 — real (non-fixture) degradation + timing of the R9/R10 lookup.
#   bash tests/evidence/t_75180b28/degradation.sh <out-dir>
# Read-only: GitHub reads + the live board. Never writes the board.
set -uo pipefail
out="${1:?usage: degradation.sh <out-dir>}"
mkdir -p "$out"
db="$HOME/.hermes/kanban.db"
gate="scripts/qa/signoff-gate.mjs"
f="$out/degradation.txt"
: > "$f"
raw="$(mktemp -d)"
node_bin="$(command -v node)"

run() {
  label="$1"; shift
  echo "---- $label" >> "$f"
  start=$(date +%s%N)
  "$@" > "$raw/tmp.json" 2>&1
  code=$?
  end=$(date +%s%N)
  echo "exit=$code elapsed_ms=$(( (end - start) / 1000000 ))" >> "$f"
  node "$(dirname "$0")/summarize.mjs" "$raw/tmp.json" >> "$f"
}

base=(env -u HERMES_KANBAN_DB -u HERMES_KANBAN_TASK -u QA_GATE_GITHUB_FIXTURE)
run "real gh, merged card t_19128fb2 (timing of a full lookup)" \
  "${base[@]}" "$node_bin" "$gate" check --task t_19128fb2 --pre-complete --db "$db" --repo "$PWD" --json
run "real gh, open-PR card t_b8001b55" \
  "${base[@]}" "$node_bin" "$gate" check --task t_b8001b55 --pre-complete --db "$db" --repo "$PWD" --json
run "invalid token (GH_TOKEN=invalid) -> A11, never a violation" \
  "${base[@]}" GH_TOKEN=invalid "$node_bin" "$gate" check --task t_b8001b55 --pre-complete --db "$db" --repo "$PWD" --json
nogh="$(mktemp -d)"
ln -s "$(command -v git)" "$nogh/git"
run "gh not on PATH (PATH holds only git) -> A11" \
  "${base[@]}" PATH="$nogh" "$node_bin" "$gate" check --task t_b8001b55 --pre-complete --db "$db" --repo "$PWD" --json
run "unreachable API host (GH_HOST=github.invalid) -> A11" \
  "${base[@]}" GH_HOST=github.invalid GH_ENTERPRISE_TOKEN=x "$node_bin" "$gate" check --task t_b8001b55 --pre-complete --db "$db" --repo "$PWD" --json
run "time budget exhausted (QA_GATE_GH_BUDGET_MS=1) -> A11" \
  "${base[@]}" QA_GATE_GH_BUDGET_MS=1 "$node_bin" "$gate" check --task t_b8001b55 --pre-complete --db "$db" --repo "$PWD" --json

echo "---- hook, real gh, payload cwd = a non-git scratch dir (worker workspace shape)" >> "$f"
scratch="$(mktemp -d)"
printf '{"hook_event_name":"pre_tool_call","tool_name":"kanban_complete","tool_input":{"task_id":"t_b8001b55"},"cwd":"%s","extra":{}}' "$scratch" > "$raw/hook-payload.json"
start=$(date +%s%N)
env -u HERMES_KANBAN_TASK -u HERMES_KANBAN_WORKSPACE -u HERMES_KANBAN_BRANCH -u QA_GATE_GITHUB_FIXTURE HERMES_KANBAN_DB="$db" \
  "$node_bin" "$gate" hook < "$raw/hook-payload.json" > "$raw/hook-out.txt" 2>&1
code=$?
end=$(date +%s%N)
echo "exit=$code elapsed_ms=$(( (end - start) / 1000000 ))" >> "$f"
cat "$raw/hook-out.txt" >> "$f"
echo >> "$f"
cat "$f"
