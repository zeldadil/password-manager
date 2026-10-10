#!/usr/bin/env bash
# t_1708dc86 — doc-verification replay of the corrected README Quick Start +
# "Configuration (optional)" .env.local flow, on a fresh clone, under Node 22.
#
# Usage: replay-quick-start.sh <git-url-or-path> <ref>
# All values used are SYNTHETIC (example.test address, placeholder password).
set -u
SRC="${1:?git url or path}"
REF="${2:?branch or commit}"
WORK="$(mktemp -d)"
API_PID=""
cleanup() { [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null; pkill -f "$WORK" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

step() { printf '\n=== %s ===\n' "$*"; }
fail() { echo "FAIL: $*"; exit 1; }

# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh" >/dev/null

step "1. Clone ($SRC @ $REF)"
git clone -q "$SRC" "$WORK/password-manager" || fail clone
cd "$WORK/password-manager" || fail cd
git checkout -q "$REF" || fail checkout
git log --oneline -1

step "2. nvm install && nvm use (reads .nvmrc)"
echo ".nvmrc: $(cat .nvmrc)"
nvm install >/dev/null 2>&1; nvm use >/dev/null || fail "nvm use"
echo "node $(node -v)"

step "3. corepack enable && pnpm install"
corepack enable
echo "pnpm $(pnpm -v)"
start=$(date +%s)
pnpm install --frozen-lockfile >"$WORK/install.log" 2>&1 || { tail -30 "$WORK/install.log"; fail "pnpm install"; }
echo "pnpm install OK in $(( $(date +%s) - start ))s"

step "Config: cp .env.example .env.local, edit PORT, export with set -a"
grep -n '^DATABASE_URL=' .env.example
cp .env.example .env.local
# Edit one value so we can prove the file is actually read (not inert).
sed -i 's/^PORT=3000$/PORT=3999/' .env.local
grep -nE '^(PORT|HOST|NODE_ENV|DATABASE_URL|AUTO_LOCK_TIMEOUT_MS)=' .env.local
set -a; . ./.env.local; set +a
echo "exported: PORT=$PORT HOST=$HOST NODE_ENV=$NODE_ENV DATABASE_URL=$DATABASE_URL"

step "4. pnpm --filter @password-manager/api migrate (with exported DATABASE_URL)"
pnpm --filter @password-manager/api migrate 2>&1 | tail -3
ls -l apps/services/api/dev.db || fail "dev.db not created"

step "Real API entry point (pnpm --filter @password-manager/api start = tsx src/index.ts)"
pnpm --filter @password-manager/api start >"$WORK/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 30); do curl -fs "http://127.0.0.1:3999/health" >/dev/null 2>&1 && break; sleep 1; done
echo "--- api log ---"; cat "$WORK/api.log"
echo "--- GET /health on PORT from .env.local (3999) ---"
curl -fsS http://127.0.0.1:3999/health || fail "health on 3999"
echo
echo "--- POST /auth/register (synthetic) ---"
curl -sS -o "$WORK/reg.json" -w 'HTTP %{http_code}\n' -X POST http://127.0.0.1:3999/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","username":"alice","masterPassword":"correct-horse-battery-staple"}'
head -c 300 "$WORK/reg.json"; echo
echo "--- POST /auth/unlock (synthetic; tokens redacted) ---"
code=$(curl -sS -o "$WORK/unlock.json" -w '%{http_code}' -X POST http://127.0.0.1:3999/auth/unlock \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","masterPassword":"correct-horse-battery-staple"}')
echo "HTTP $code"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data??j;console.log("keys:",Object.keys(d).join(","),"tokenType:",d.tokenType)' "$WORK/unlock.json"
grep -iE 'error|cannot open' "$WORK/api.log" && fail "errors in API log"
kill "$API_PID"; wait "$API_PID" 2>/dev/null; API_PID=""
pkill -f "$WORK/password-manager/apps/services/api" 2>/dev/null; sleep 1

step "Negative control: old value DATABASE_URL=file:./dev.db on the same entry point"
DATABASE_URL='file:./dev.db' PORT=3998 timeout 20 pnpm --filter @password-manager/api start >"$WORK/neg.log" 2>&1
echo "exit code: $?"
grep -m1 -E 'TypeError|SqliteError|Cannot open' "$WORK/neg.log"

step "5. pnpm dev (API + Web UI) with the exported .env.local"
pnpm dev >"$WORK/dev.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 40); do curl -fs http://127.0.0.1:3999/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3999/health || fail "pnpm dev API health"
echo
grep -oE 'Local: +http://[^ ]+' "$WORK/dev.log" | head -1
kill "$API_PID"; wait "$API_PID" 2>/dev/null; API_PID=""

step "RESULT: PASS"
