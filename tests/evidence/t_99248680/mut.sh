set -u
export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:$PATH
W=/home/sap/.hermes/kanban/workspaces/t_99248680
cd $W/repo/apps/web
echo "## mutation: vite.config.ts from b1db88f^ (pre-fix)"
git show b1db88f^:apps/web/vite.config.ts > vite.config.ts
git diff --stat
npx vitest run dev-proxy.test.ts 2>&1 | grep -E "✓|×|FAIL|Tests |expected" | head -20
git checkout -- vite.config.ts
git status --short
echo "## restored; re-run"
npx vitest run dev-proxy.test.ts 2>&1 | grep -E "Tests "
echo "## typecheck"
pnpm typecheck > $W/typecheck.log 2>&1; echo "typecheck exit $?"
echo "## lint touched files"
npx eslint dev-proxy.ts dev-proxy.test.ts vite.config.ts; echo "eslint exit $?"
