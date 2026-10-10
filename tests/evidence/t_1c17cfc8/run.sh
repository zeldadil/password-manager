#!/usr/bin/env bash
# QA t_1c17cfc8: install + run api typecheck, new test, full api suite on Node 22 at 30334ba
set -u
export PATH=/home/sap/.hermes/profiles/qa/cache/scratch/node22/node-v22.23.3-linux-x64/bin:$PATH
cd /home/sap/.hermes/profiles/qa/cache/scratch/t_1c17cfc8/repo
echo "HEAD $(git rev-parse HEAD)"
node --version
pnpm --version
pnpm install --frozen-lockfile >/dev/null 2>&1; echo "install rc=$?"
cd apps/services/api
pnpm exec tsc --noEmit -p . ; echo "typecheck rc=$?"
pnpm exec vitest run tests/auth/refresh-jwt-secret.test.ts 2>&1 | tail -15; echo "newtest rc=${PIPESTATUS[0]}"
pnpm exec vitest run 2>&1 | tail -8; echo "suite rc=${PIPESTATUS[0]}"
