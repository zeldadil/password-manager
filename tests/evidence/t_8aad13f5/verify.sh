#!/bin/bash
# QA independent verification for t_8aad13f5 (round 1)
set -u
S=/home/sap/.hermes/profiles/qa/cache/scratch/t8aad
N=/home/sap/.hermes/profiles/qa/cache/scratch/node22
cd "$N"
echo "== node22 tarball sha check"
grep ' node-v22.23.3-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c -
mkdir -p "$S/shim"
printf '#!/bin/sh\nexec corepack pnpm@9.12.0 "$@"\n' > "$S/shim/pnpm"
chmod +x "$S/shim/pnpm"
export PATH="$S/shim:$N/node-v22.23.3-linux-x64/bin:$PATH"
echo "node $(node -v) pnpm $(pnpm -v)"
cd "$S"
test -d clone || git clone -q https://github.com/zeldadil/password-manager.git clone
cd clone
git fetch -q origin
git checkout -q --detach origin/master
echo "== ls-remote master: $(git ls-remote origin refs/heads/master)"
echo "== HEAD $(git rev-parse HEAD)"
echo "== dd7ec14 ancestor of master?"; git merge-base --is-ancestor dd7ec14 HEAD && echo yes || echo NO
echo "== .env.example DATABASE_URL + loading wording"
grep -n -i -E 'DATABASE_URL|env.local|load|export|set -a|file:' .env.example
echo "== db.ts"; cat apps/services/api/src/db.ts
echo "== drizzle.config / migrate use of DATABASE_URL"
grep -rn DATABASE_URL apps/services/api --include=*.ts | grep -v node_modules
echo "== api package.json scripts"; grep -n -A12 '"scripts"' apps/services/api/package.json
echo "== P3 loader grep (dotenv / env-file) excluding node_modules"
grep -rn -E 'dotenv|env-file|loadEnvFile|process\.loadEnvFile' --include=*.json --include=*.ts --include=*.mjs --include=*.js --include=*.cjs . 2>/dev/null | grep -v node_modules | grep -v '^./tests/evidence' || echo "no loader found"
echo "== docs mentions of .env.local (any still promising auto-load?)"
grep -rn -E '\.env\.local|\.env\b' README.md docs .env.example 2>/dev/null | grep -v '^docs/.*evidence' | head -40
echo "== file: mentions in docs"
grep -rn 'file:' README.md docs/development/setup.md .env.example | head
echo "== install"
pnpm install --frozen-lockfile >"$S/install.txt" 2>&1; echo "install exit=$?"; tail -3 "$S/install.txt"
cd apps/services/api
echo "== P1 documented flow: copy .env.example -> .env.local, override PORT/DB, set -a; . ; set +a"
cp ../../../.env.example "$S/env.local.qa"
sed -i -e 's|^DATABASE_URL=.*|DATABASE_URL=./qa-t8aad.db|' -e 's|^PORT=.*|PORT=3927|' "$S/env.local.qa"
grep -n -E '^(PORT|DATABASE_URL|JWT_SECRET|NODE_ENV)=' "$S/env.local.qa" | sed -E 's/(JWT_SECRET=).*/\1<redacted>/'
(
 set -a; . "$S/env.local.qa"; set +a
 pnpm migrate >"$S/p1-migrate.txt" 2>&1; echo "P1 migrate exit=$?"
 pnpm migrate >"$S/p1-migrate2.txt" 2>&1; echo "P1 migrate (2nd, idempotent) exit=$?"
 pnpm start >"$S/p1-start.txt" 2>&1 &
 PID=$!
 code=000
 for i in $(seq 1 30); do code=$(curl -s -o "$S/p1-health.txt" -w '%{http_code}' http://127.0.0.1:3927/health); [ "$code" = 200 ] && break; sleep 1; done
 echo "P1 /health http=$code body=$(cat "$S/p1-health.txt" 2>/dev/null)"
 pkill -P $PID 2>/dev/null; kill $PID 2>/dev/null; wait $PID 2>/dev/null
 ls -la qa-t8aad.db
)
echo "== P1c control: without exporting the file, PORT from it is NOT applied (nothing auto-loads)"
cp "$S/env.local.qa" ../../../.env.local
cp "$S/env.local.qa" .env.local
( env -u PORT -u DATABASE_URL pnpm start >"$S/p1c-start.txt" 2>&1 & PID=$!; sleep 6
  c1=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3927/health); echo "P1c port 3927 (would need auto-load) http=$c1"
  pkill -P $PID 2>/dev/null; kill $PID 2>/dev/null; wait $PID 2>/dev/null; grep -i -E 'listen|port|error' "$S/p1c-start.txt" | head -5 )
rm -f ../../../.env.local .env.local
echo "== P1b unmodified .env.example value"
( DATABASE_URL=./dev.db pnpm migrate >"$S/p1b.txt" 2>&1; echo "P1b exit=$?" )
echo "== P2 negative control file:./dev.db"
( DATABASE_URL=file:./dev.db pnpm migrate >"$S/p2.txt" 2>&1; echo "P2 exit=$?"; grep -m1 -o 'TypeError: [^\x27]*\|Cannot open database[^\x27]*' "$S/p2.txt" )
rm -f qa-t8aad.db qa-t8aad.db-* dev.db dev.db-*
cd ../../..
echo "== git status (expect clean)"; git status --porcelain
echo "== done"
