#!/usr/bin/env bash
# QA fresh-clone walkthrough of docs/development/setup.md (t_750423a5 -> t_f443682a)
# Commands from the guide are copied verbatim; only additions are logging, exit codes,
# HTTP status capture (-w) and token redaction for the evidence log.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_750423a5/run3
CL=$WS/clone
redact() { sed -E 's/"(accessToken|refreshToken)":"[^"]+"/"\1":"<redacted>"/g'; }
step() { echo; echo "=== $* ==="; }

step "env"
date -u +%FT%TZ
uname -sr

step "§2 clone"
git clone -q https://github.com/zeldadil/password-manager.git "$CL"; echo "clone rc=$?"
cd "$CL"
echo "HEAD=$(git rev-parse HEAD)"
git ls-remote origin refs/heads/master
git merge-base --is-ancestor a56dc76 HEAD; echo "a56dc76 ancestor-of-HEAD rc=$?"
sha256sum docs/development/setup.md

step "§1/§2 nvm use + corepack enable"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
nvm use; echo "nvm use rc=$?"
node --version
corepack enable; echo "corepack enable rc=$?"
pnpm --version

step "§2 pnpm install"
pnpm install > "$WS/install.txt" 2>&1; echo "pnpm install rc=$?"
tail -5 "$WS/install.txt"

step "§5 migrate (run 1)"
pnpm --filter @password-manager/api migrate; echo "migrate#1 rc=$?"
step "§5 migrate (run 2, idempotency)"
pnpm --filter @password-manager/api migrate; echo "migrate#2 rc=$?"
ls -la apps/services/api/dev.db
ls apps/services/api/migrations/*.sql | wc -l
sqlite3 apps/services/api/dev.db "select count(*) from __drizzle_migrations;" 2>&1
sqlite3 apps/services/api/dev.db ".tables" 2>&1

step "§7.1 pnpm dev (background)"
pnpm dev > "$WS/dev.txt" 2>&1 &
DEVPID=$!
for i in $(seq 1 60); do
  curl -s -o /dev/null http://127.0.0.1:3000/health && grep -q 'localhost:5173' "$WS/dev.txt" && break
  sleep 1
done
echo "waited ${i}s"
grep -E 'Scope:|dev\$|ready in|Local:|listening at' "$WS/dev.txt"
curl -s -o /dev/null -w 'web 5173 -> %{http_code}\n' http://localhost:5173/

step "§8.1 health"
curl http://127.0.0.1:3000/health -w '\nHTTP %{http_code}\n'

step "§8.2 openapi"
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:3000/openapi.json

step "§8.3 register"
curl -X POST http://127.0.0.1:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","username":"alice","masterPassword":"correct-horse-battery-staple"}' -s -w '\nHTTP %{http_code}\n'
step "§8.3 register duplicate"
curl -X POST http://127.0.0.1:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","username":"alice","masterPassword":"correct-horse-battery-staple"}' -s -w '\nHTTP %{http_code}\n'
step "§8.3 unlock (tokens redacted)"
curl -X POST http://127.0.0.1:3000/auth/unlock \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","masterPassword":"correct-horse-battery-staple"}' -s -w '\nHTTP %{http_code}\n' | redact

step "§8.4 TOKEN extraction (verbatim)"
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/auth/unlock \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","masterPassword":"correct-horse-battery-staple"}' \
  | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
echo "TOKEN length=${#TOKEN} segments=$(echo "$TOKEN" | awk -F. '{print NF}')"

step "§8.4 POST folders"
curl -X POST http://127.0.0.1:3000/api/v1/folders \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Synthetic folder"}' -s -w '\nHTTP %{http_code}\n'
step "§8.4 GET folders"
curl http://127.0.0.1:3000/api/v1/folders -H "authorization: Bearer $TOKEN" -s -w '\nHTTP %{http_code}\n'
step "§8.4 GET folders without auth"
curl http://127.0.0.1:3000/api/v1/folders -s -w '\nHTTP %{http_code}\n'

step "stop pnpm dev"
pkill -TERM -P "$DEVPID" 2>/dev/null; kill -TERM "$DEVPID" 2>/dev/null
sleep 3
pkill -f "$CL/node_modules" 2>/dev/null
echo "stopped"
