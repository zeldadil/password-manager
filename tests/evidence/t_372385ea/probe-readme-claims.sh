#!/usr/bin/env bash
# QA probe for t_65c5a636 (README + .env.example, PR #118, merge d612272), run from a fresh clone of origin/master.
# Usage: NODE22_BIN=<dir with node 22> bash tests/evidence/t_372385ea/probe-readme-claims.sh
# P1  Does anything load `.env.local` (README Quick start step 3)?  -> grep for env-file loaders in the API + dev scripts
# P2  What does better-sqlite3 do with DATABASE_URL=file:./dev.db (value in .env.example)?
# P3  Does the API receive the master password (README "What it is NOT": "the server never sees the master password")?
set -u
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"
export PATH="$NODE22_BIN:$PATH"
echo "repo HEAD: $(git rev-parse HEAD)  node: $(node --version)"

echo "=== P1 env-file loaders (dotenv / --env-file / loadEnvFile / .env.local) in api src + package scripts"
git grep -nE "dotenv|env-file|loadEnvFile|\.env\.local" -- apps/services/api package.json apps/services/api/package.json ':!*.test.*' || echo "P1: no match (nothing loads .env.local for the API)"
echo "api dev script: $(node -p "require('./apps/services/api/package.json').scripts.dev")"

echo "=== P2 better-sqlite3 with DATABASE_URL=file:./dev.db"
pnpm install --frozen-lockfile --reporter=silent > /dev/null 2>&1; echo "install exit=$?"
PROBE_DIR="${TMPDIR:-/tmp}/t_372385ea-sqlite-probe"
mkdir -p "$PROBE_DIR"
cat > apps/services/api/qa-probe.cjs <<'EOF'
const Database = require('better-sqlite3');
process.chdir(process.argv[2]);
const db = new Database('file:./dev.db');
db.exec('create table if not exists t(x)');
db.close();
console.log('files created:', require('fs').readdirSync('.').join(', '));
EOF
( cd apps/services/api && node qa-probe.cjs "$PROBE_DIR" ); echo "probe exit=$?"
mv apps/services/api/qa-probe.cjs "$PROBE_DIR/qa-probe.cjs.used"
echo "=== P2b real API entry point (apps/services/api src/index.ts) with DATABASE_URL=file:./dev.db, cwd=$PROBE_DIR"
( cd "$PROBE_DIR" && DATABASE_URL=file:./dev.db PORT=39117 timeout 20 "$REPO/apps/services/api/node_modules/.bin/tsx" "$REPO/apps/services/api/src/index.ts" 2>&1 | grep -E "TypeError|Error|listening|Server" | head -5 ); echo "(end P2b)"
echo "=== P2c same entry point with the documented default (DATABASE_URL unset) for contrast"
( cd "$PROBE_DIR" && env -u DATABASE_URL PORT=39118 timeout 10 "$REPO/apps/services/api/node_modules/.bin/tsx" "$REPO/apps/services/api/src/index.ts" 2>&1 | grep -E "TypeError|Error|listening|Server" | head -5 ); echo "(timeout 124 = still running = started fine)"

echo "=== P3 master password in API request bodies / web client"
git grep -nE "masterPassword" -- apps/services/api/src/auth/register.ts apps/services/api/src/auth/unlock.ts | grep -E "request.body|Buffer.from|required" 
git grep -nE "JSON.stringify\(\{ masterPassword" -- apps/web/src ':!*.test.*'
echo "=== P3b README claims under test"
grep -nE "server never sees the master password|client-derived vault key|not yet wired" README.md
echo "=== P4 duplicated Node paragraph (Prerequisites vs Quick start)"
grep -nc "ERR_PNPM_UNSUPPORTED_ENGINE" README.md
grep -nE "ERR_PNPM_UNSUPPORTED_ENGINE" README.md
echo "=== P5 setup guide referenced by README"
ls docs/development/setup.md 2>&1
