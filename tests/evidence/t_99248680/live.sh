set -u
# Live verification: pnpm dev + Chromium harness. Usage: bash live.sh <label> [PORT]
LABEL=$1
APIPORT=${2:-}
export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:$PATH
W=/home/sap/.hermes/kanban/workspaces/t_99248680
cd $W/repo
echo "## node $(node --version), master $(git rev-parse --short HEAD), label $LABEL, PORT=${APIPORT:-<unset>}"
if [ -n "$APIPORT" ]; then export PORT=$APIPORT; else unset PORT; fi
unset HOST API_PROXY_TARGET
pnpm --filter @password-manager/api migrate > $W/migrate-$LABEL.log 2>&1; echo "migrate exit $?"
setsid pnpm dev > $W/dev-$LABEL.log 2>&1 &
DEVPID=$!
API=${APIPORT:-3000}
n=0
until curl -s -o /dev/null http://127.0.0.1:$API/health && curl -s -o /dev/null http://localhost:5173/; do
  n=$((n+1)); if [ $n -gt 60 ]; then echo "servers not up after 60s"; break; fi; sleep 1
done
echo "## direct API: GET 127.0.0.1:$API/health -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$API/health)"
echo "## curl via :5173"
c() { curl -s -o /dev/null -w "%{http_code} %{content_type}" "$@"; }
echo "POST :5173/auth/unlock (empty JSON) -> $(c -X POST -H 'content-type: application/json' -d '{}' http://localhost:5173/auth/unlock)"
echo "GET :5173/api/v1/resources -> $(c http://localhost:5173/api/v1/resources)"
echo "GET :5173/login (SPA) -> $(c http://localhost:5173/login)"
echo "GET :5173/vault (SPA) -> $(c http://localhost:5173/vault)"
echo "## abuse / boundary cases"
echo "GET :5173/authors (must stay with Vite) -> $(c http://localhost:5173/authors)"
echo "GET :5173/auth (no slash, stays with Vite) -> $(c http://localhost:5173/auth)"
echo "GET :5173/api/v2/x (not proxied) -> $(c http://localhost:5173/api/v2/x)"
echo "GET :5173/health (not proxied) -> $(c http://localhost:5173/health)"
echo "GET :5173/auth/%2e%2e/health (encoded traversal) -> $(c --path-as-is http://localhost:5173/auth/%2e%2e/health)"
echo "GET :5173/auth/../health (raw traversal, --path-as-is) -> $(c --path-as-is http://localhost:5173/auth/../health)"
echo "POST :5173/auth/unlock Host: evil.example.test -> $(c -X POST -H 'Host: evil.example.test' -H 'content-type: application/json' -d '{}' http://localhost:5173/auth/unlock)"
echo "## harness"
node tests/evidence/t_aeb2617e/browser-unlock.mjs; echo "harness exit $?"
cp tests/evidence/t_aeb2617e/vault-after-unlock.png $W/vault-after-unlock-$LABEL.png
git checkout -- tests/evidence/t_aeb2617e/vault-after-unlock.png
echo "## dev log secret check (tokens / password echoed?)"
grep -ciE 'accessToken|refreshToken|synthetic-correct-horse|masterPassword' $W/dev-$LABEL.log
kill -- -$DEVPID 2>/dev/null; sleep 2
ss -ltn | grep -E ':(5173|'$API')\b' | grep -v 192.168.1.150 || echo "servers stopped"
