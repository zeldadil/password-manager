#!/bin/bash
# QA t_8aad13f5: P1 / P1c re-run with process-group kill (first run leaked servers -> P1c invalid)
set -u
S=/home/sap/.hermes/profiles/qa/cache/scratch/t8aad
N=/home/sap/.hermes/profiles/qa/cache/scratch/node22
export PATH="$S/shim:$N/node-v22.23.3-linux-x64/bin:$PATH"
cd "$S/clone/apps/services/api"
echo "HEAD $(git rev-parse HEAD) node $(node -v)"
free() { ss -ltn | grep -q -E "127.0.0.1:$1\b" && echo "port $1 BUSY" || echo "port $1 free"; }
stop() { kill -- -"$1" 2>/dev/null; sleep 2; }
free 3927; free 3000
echo "== P1: set -a; . env.local copy; set +a; migrate; start"
(
 set -a; . "$S/env.local.qa"; set +a
 echo "exported PORT=$PORT DATABASE_URL=$DATABASE_URL"
 pnpm migrate >"$S/p1r-migrate.txt" 2>&1; echo "P1 migrate exit=$?"
 setsid pnpm start >"$S/p1r-start.txt" 2>&1 &
 PID=$!
 code=000
 for i in $(seq 1 30); do code=$(curl -s -o "$S/p1r-health.txt" -w '%{http_code}' http://127.0.0.1:3927/health); [ "$code" = 200 ] && break; sleep 1; done
 echo "P1 /health :3927 http=$code body=$(cat "$S/p1r-health.txt")"
 grep -o 'listening at [^ ]*' "$S/p1r-start.txt" | head -1
 stop $PID
)
ls -la qa-t8aad.db
free 3927; free 3000
echo "== P1c: .env.local present at repo root AND api dir, NOT exported -> must NOT be applied"
cp "$S/env.local.qa" ../../../.env.local
cp "$S/env.local.qa" .env.local
git -C ../../.. check-ignore -q .env.local && echo ".env.local is gitignored"
(
 unset PORT DATABASE_URL
 setsid pnpm start >"$S/p1c-start.txt" 2>&1 &
 PID=$!
 for i in $(seq 1 30); do c0=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health); [ "$c0" = 200 ] && break; sleep 1; done
 c1=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3927/health)
 echo "P1c :3000 (default) http=$c0 ; :3927 (only via auto-load) http=$c1"
 grep -o 'listening at [^ ]*' "$S/p1c-start.txt" | head -1
 stop $PID
)
rm -f ../../../.env.local .env.local qa-t8aad.db qa-t8aad.db-* dev.db dev.db-*
free 3927; free 3000
echo "git status:"; git -C ../../.. status --porcelain
echo done
