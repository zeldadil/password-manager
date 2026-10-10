#!/usr/bin/env bash
# QA independent replay for t_1708dc86 (PR #133). Follows README "Quick Start" +
# "Configuration (optional)" literally on a fresh GitHub clone, under Node 22.
# Synthetic values only. Tokens are never printed (only HTTP status + key names).
set -u
SHA="${1:?usage: qa-replay.sh <pr-head-sha> <workdir>}"
WORK="${2:?workdir}"
REPO_URL=https://github.com/zeldadil/password-manager.git
export PATH="/home/sap/.nvm/versions/node/v22.23.3/bin:$PATH"
SHIM="$WORK/shim"; mkdir -p "$SHIM"
printf '#!/bin/sh\nexec corepack pnpm@9.12.0 "$@"\n' > "$SHIM/pnpm"; chmod +x "$SHIM/pnpm"
export PATH="$SHIM:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
FAIL=0
ok()   { echo "CHECK PASS: $*"; }
bad()  { echo "CHECK FAIL: $*"; FAIL=1; }

echo "== toolchain"; node -v; pnpm -v; date -u +%FT%TZ
C="$WORK/clone"
git clone -q "$REPO_URL" "$C" || exit 2
cd "$C" || exit 2
git fetch -q origin "pull/133/head" || exit 2
git checkout -q "$SHA" || exit 2
echo "HEAD=$(git rev-parse HEAD)"
[ "$(git rev-parse HEAD)" = "$SHA" ] && ok "clone at PR head" || bad "clone sha"

echo "== pnpm install"
pnpm install --frozen-lockfile > "$WORK/install.txt" 2>&1; rc=$?
tail -3 "$WORK/install.txt"
[ $rc -eq 0 ] && ok "install rc=0" || bad "install rc=$rc"

wait_port() { # port timeout
  local i; for i in $(seq 1 "$2"); do
    curl -s -o /dev/null "http://127.0.0.1:$1/health" && return 0; sleep 1; done; return 1; }
api_checks() { # port label
  local p=$1 h r u
  h=$(curl -s -o "$WORK/health.$2.json" -w '%{http_code}' "http://127.0.0.1:$p/health")
  echo "health HTTP $h body=$(cat "$WORK/health.$2.json")"
  r=$(curl -s -o "$WORK/reg.$2.json" -w '%{http_code}' -X POST "http://127.0.0.1:$p/auth/register" \
      -H 'content-type: application/json' \
      -d "{\"email\":\"qa-$2@example.test\",\"username\":\"qa$2\",\"masterPassword\":\"correct-horse-battery-staple\"}")
  echo "register HTTP $r keys=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=o.data??o;console.log(Object.keys(d).join(","))' "$WORK/reg.$2.json" 2>/dev/null)"
  u=$(curl -s -o "$WORK/unl.$2.json" -w '%{http_code}' -X POST "http://127.0.0.1:$p/auth/unlock" \
      -H 'content-type: application/json' \
      -d "{\"email\":\"qa-$2@example.test\",\"masterPassword\":\"correct-horse-battery-staple\"}")
  echo "unlock HTTP $u keys=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=o.data??o;console.log(Object.keys(d).join(","))' "$WORK/unl.$2.json" 2>/dev/null)"
  rm -f "$WORK/unl.$2.json"   # holds tokens; never kept
  [ "$h" = 200 ] && [ "$r" = 201 ] && [ "$u" = 200 ]
}
stop_group() { kill -TERM -- "-$1" 2>/dev/null; sleep 2; kill -KILL -- "-$1" 2>/dev/null; }

PORT_A=3000
if ss -ltn | grep -q ":$PORT_A "; then echo "NOTE: :3000 busy on host"; fi

echo; echo "== Case A: README Configuration block verbatim, .env.local = unmodified copy of .env.example"
cp .env.example .env.local
(
  set -a; . ./.env.local; set +a
  echo "exported: PORT=$PORT HOST=$HOST NODE_ENV=$NODE_ENV DATABASE_URL=$DATABASE_URL AUTO_LOCK_TIMEOUT_MS=$AUTO_LOCK_TIMEOUT_MS"
  pnpm --filter @password-manager/api migrate > "$WORK/migrateA.txt" 2>&1; echo "migrate rc=$?"; tail -3 "$WORK/migrateA.txt"
) | tee "$WORK/caseA-pre.txt"
grep -q 'migrate rc=0' "$WORK/caseA-pre.txt" && ok "A migrate rc=0" || bad "A migrate"
[ -f apps/services/api/dev.db ] && ok "A dev.db at apps/services/api/dev.db ($(stat -c %s apps/services/api/dev.db) bytes)" || bad "A dev.db missing"
[ -e dev.db ] && bad "A dev.db unexpectedly at repo root" || ok "A no dev.db at repo root"
setsid bash -c 'set -a; . ./.env.local; set +a; exec pnpm --filter @password-manager/api start' > "$WORK/apiA.txt" 2>&1 &
PG=$!
if wait_port $PORT_A 60; then api_checks $PORT_A A && ok "A real entry point (start) on :$PORT_A health/register/unlock 200/201/200" || bad "A api checks"
else bad "A API did not listen on :$PORT_A"; fi
stop_group $PG
grep -iE 'error|cannot open' "$WORK/apiA.txt" && bad "A error in API log" || ok "A no error in API log"

echo; echo "== Case B: edit PORT in .env.local -> 3917, export, pnpm dev (README block)"
sed -i 's/^PORT=.*/PORT=3917/' .env.local
setsid bash -c 'set -a; . ./.env.local; set +a; exec pnpm dev' > "$WORK/devB.txt" 2>&1 &
PG=$!
if wait_port 3917 90; then api_checks 3917 B && ok "B pnpm dev API follows .env.local PORT=3917" || bad "B api checks"
else bad "B API did not listen on :3917"; fi
stop_group $PG
grep -iE 'cannot open|EADDRINUSE' "$WORK/devB.txt" && bad "B error in dev log" || ok "B no db/port error in dev log"

echo; echo "== Case C (control): .env.local NOT exported -> PORT from file has no effect"
setsid bash -c 'exec env PORT=3918 pnpm --filter @password-manager/api start' > "$WORK/apiC.txt" 2>&1 &
PG=$!
wait_port 3918 60 && ok "C sanity: env var path works (3918)" || bad "C sanity"
curl -s -o /dev/null "http://127.0.0.1:3917/health" && bad "C 3917 answered without export" || ok "C 3917 silent without export (file alone is inert, as documented)"
stop_group $PG

echo; echo "== Case D (negative control): DATABASE_URL=file:./dev.db (old .env.example value)"
setsid bash -c 'exec env PORT=3919 DATABASE_URL=file:./dev.db pnpm --filter @password-manager/api start' > "$WORK/apiD.txt" 2>&1 &
PG=$!
sleep 12
if curl -s -o /dev/null "http://127.0.0.1:3919/health"; then
  hc=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3919/auth/register -H 'content-type: application/json' -d '{"email":"qa-d@example.test","username":"qad","masterPassword":"correct-horse-battery-staple"}')
  echo "D listened; register HTTP $hc"
fi
stop_group $PG
grep -m1 -i 'cannot open database' "$WORK/apiD.txt" && ok "D file: URL fails as documented" || bad "D negative control did not fail"

echo; echo "== Old value from master's .env.example, sourced the same way"
git show origin/master:.env.example | grep '^DATABASE_URL='
echo; [ $FAIL -eq 0 ] && echo "RESULT: PASS" || echo "RESULT: FAIL"
exit $FAIL
