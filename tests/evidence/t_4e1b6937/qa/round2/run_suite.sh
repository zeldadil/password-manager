#!/bin/bash
# Round-2 CI-parity runner for the qa verification clone.
# The repo pins packageManager=pnpm@9.12.0; a global pnpm (v12) fails the version
# check on nested `pnpm -r run <script>` delegation, so a shim first on PATH
# resolves every pnpm invocation to the pinned version (as pnpm/action-setup does in CI).
set -uo pipefail
QADIR=/home/sap/.hermes/kanban/workspaces/t_4e1b6937/qa_r2
mkdir -p "$QADIR/shim"
printf '%s\n' '#!/bin/sh' 'exec corepack pnpm@9.12.0 "$@"' > "$QADIR/shim/pnpm"
chmod +x "$QADIR/shim/pnpm"
export PATH="$QADIR/shim:$PATH"
cd "$QADIR/pm"
echo "pnpm -> $(command -v pnpm) | $(pnpm -v) | node $(node -v)"
for step in typecheck lint test:unit test:integration build; do
  echo "########## pnpm $step ##########"
  out=$(pnpm "$step" 2>&1)
  code=$?
  printf '%s\n' "$out" | tail -20
  echo "[$step] exit=$code"
done
echo "########## vitest version ##########"
pnpm exec vitest --version
