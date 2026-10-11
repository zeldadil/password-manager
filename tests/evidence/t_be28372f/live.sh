set -u
# QA live check for t_be28372f (docs PR #149, e4e150c). Usage: bash live.sh
export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:$PATH
EV=/home/sap/.hermes/kanban/workspaces/t_be28372f/ev
cd /home/sap/.hermes/kanban/workspaces/t_be28372f/qa-clone
echo "## node $(node --version), pnpm $(pnpm --version), HEAD $(git rev-parse --short HEAD)"
unset HOST PORT API_PROXY_TARGET
pnpm install --frozen-lockfile > $EV/install.out.txt 2>&1; echo "install exit $?"
pnpm --filter @password-manager/api migrate > $EV/migrate.out.txt 2>&1; echo "migrate exit $?"

c() { curl -s -o /dev/null -w "%{http_code} %{content_type}" "$@"; }
waitfor() { n=0; until curl -s -o /dev/null "$1"; do n=$((n+1)); if [ $n -gt 60 ]; then echo "not up: $1"; return 1; fi; sleep 1; done; }
stop() { kill -- -$1 2>/dev/null; sleep 3; }
REG='{"email":"qa.curl+STAMP@example.test","username":"qacurlSTAMP","masterPassword":"synthetic-docs-check-battery-staple"}'

echo; echo "## A: default pnpm dev (README Quick Start), browser probe"
setsid pnpm dev > $EV/dev-A.out.txt 2>&1 & P=$!
waitfor http://127.0.0.1:3000/health; waitfor http://localhost:5173/
echo "GET 127.0.0.1:3000/health direct -> $(c http://127.0.0.1:3000/health)"
node $EV/vault-probe.mjs; echo "probe exit $?"
stop $P

echo; echo "## B: PORT=3311 pnpm dev, curl through :5173"
PORT=3311 setsid pnpm dev > $EV/dev-B.out.txt 2>&1 & P=$!
waitfor http://127.0.0.1:3311/health; waitfor http://localhost:5173/
S=$(date +%s%N); B=${REG//STAMP/$S}
echo "POST :5173/auth/register -> $(c -X POST -H 'content-type: application/json' -d "$B" http://localhost:5173/auth/register)"
echo "POST :5173/auth/unlock -> $(c -X POST -H 'content-type: application/json' -d "{\"email\":\"qa.curl+$S@example.test\",\"masterPassword\":\"synthetic-docs-check-battery-staple\"}" http://localhost:5173/auth/unlock)"
echo "GET :5173/api/v1/resources (no token) -> $(c http://localhost:5173/api/v1/resources)"
echo "GET :5173/login -> $(c http://localhost:5173/login)"
echo "listening on 127.0.0.1:3000? $(ss -ltn | grep -c '127.0.0.1:3000 ')"
stop $P

echo; echo "## C: API alone on PORT=3312, Web UI alone with API_PROXY_TARGET (setup.md 7.3 example)"
PORT=3312 setsid pnpm --filter @password-manager/api start > $EV/api-C.out.txt 2>&1 & PA=$!
waitfor http://127.0.0.1:3312/health
API_PROXY_TARGET=http://127.0.0.1:3312 setsid pnpm --filter @password-manager/web dev > $EV/web-C.out.txt 2>&1 & PW=$!
waitfor http://localhost:5173/
S=$(date +%s%N); B=${REG//STAMP/$S}
echo "POST :5173/auth/register -> $(c -X POST -H 'content-type: application/json' -d "$B" http://localhost:5173/auth/register)"
echo "GET :5173/api/v1/resources (no token) -> $(c http://localhost:5173/api/v1/resources)"
stop $PW

echo; echo "## D: control - same split, Web UI WITHOUT API_PROXY_TARGET (proxy -> 127.0.0.1:3000, nothing there)"
setsid pnpm --filter @password-manager/web dev > $EV/web-D.out.txt 2>&1 & PW=$!
waitfor http://localhost:5173/
echo "POST :5173/auth/unlock -> $(c -X POST -H 'content-type: application/json' -d '{}' http://localhost:5173/auth/unlock)"
echo "GET :5173/api/v1/resources -> $(c http://localhost:5173/api/v1/resources)"
echo "vite log proxy error lines: $(grep -ci 'proxy error' $EV/web-D.out.txt)"
stop $PW
stop $PA

echo; echo "## secret check on dev logs (password / token keys echoed?)"
cat $EV/dev-A.out.txt $EV/dev-B.out.txt $EV/api-C.out.txt $EV/web-C.out.txt $EV/web-D.out.txt | grep -ciE 'accessToken|refreshToken|synthetic-docs-check|masterPassword'
ss -ltn | grep -E '127.0.0.1:(3000|3311|3312)|:5173' || echo "all servers stopped"
