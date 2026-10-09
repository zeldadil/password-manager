#!/usr/bin/env bash
# QA replay for t_7e1cea21 (TOOL-001, PR #117, merge b19fe27) — run from a fresh clone of origin/master.
# Usage: NODE22_BIN=<dir with node 22> NODE26_BIN=<dir with node 26> bash tests/evidence/t_372385ea/replay-engine-strict.sh
# Three cases, each in a throw-away copy of the tree (the clone itself is never mutated):
#   A  Node 26 (non-conforming), .npmrc present  -> expect exit != 0 and ERR_PNPM_UNSUPPORTED_ENGINE
#   B  Node 26 (non-conforming), .npmrc removed  -> expect exit 0 with only a WARN (shows engine-strict is load-bearing)
#   C  Node 22 (conforming),     .npmrc present  -> expect exit 0
set -u
REPO="$(git rev-parse --show-toplevel)"
WORK="${TMPDIR:-/tmp}/t_372385ea-replay"
mkdir -p "$WORK"
echo "repo HEAD: $(git -C "$REPO" rev-parse HEAD)"
echo "pnpm: $(command -v pnpm)"

run_case() {
  local name="$1" nodebin="$2" keep_npmrc="$3"
  local dir="$WORK/case-$name"
  if [ -e "$dir" ]; then mv "$dir" "$dir.old.$$"; fi
  git -C "$REPO" worktree add --detach -q "$dir" HEAD
  if [ "$keep_npmrc" = "no" ]; then mv "$dir/.npmrc" "$dir/.npmrc.disabled"; fi
  echo "=== case $name: node=$(PATH="$nodebin:$PATH" node --version) npmrc=$keep_npmrc"
  ( cd "$dir" && PATH="$nodebin:$PATH" pnpm install --frozen-lockfile --reporter=append-only > "$WORK/case-$name.log" 2>&1 )
  local rc=$?
  echo "exit=$rc"
  grep -nE "ERR_PNPM_UNSUPPORTED_ENGINE|Unsupported engine|Expected version|Got:|Done in|packages are|WARN" "$WORK/case-$name.log" | head -12
  git -C "$REPO" worktree remove --force "$dir"
}

run_case A "$NODE26_BIN" yes
run_case B "$NODE26_BIN" no
run_case C "$NODE22_BIN" yes
