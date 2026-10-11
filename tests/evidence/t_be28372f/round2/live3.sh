set -u
# QA round-2 live check for t_be28372f (docs PR #152, cadaea2), run on origin/master. Usage: bash live3.sh
export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:$PATH
EV=/home/sap/.hermes/kanban/workspaces/t_be28372f/ev3
cd /home/sap/.hermes/kanban/workspaces/t_be28372f/qa-clone
unset HOST PORT API_PROXY_TARGET
echo "## node $(node --version), pnpm $(pnpm --version), HEAD $(git rev-parse --short HEAD)"
pnpm install --frozen-lockfile > $EV/install.out.txt 2>&1; echo "install exit $?"
pnpm --filter @password-manager/api migrate > $EV/migrate.out.txt 2>&1; echo "migrate exit $?"
c() { curl -s -o /dev/null -w "%{http_code} %{content_type}" "$@"; }
waitfor() { n=0; until curl -s -o /dev/null "$1"; do n=$((n+1)); if [ $n -gt 60 ]; then echo "not up: $1"; return 1; fi; sleep 1; done; }
stop() { kill -- -$1 2>/dev/null; sleep 3; }

echo; echo "## F: default pnpm dev, Vault caveat + Retry (setup.md 7.3 / 8 step 5 / README Known limitation)"
setsid pnpm dev > $EV/dev-F.out.txt 2>&1 & P=$!
waitfor http://127.0.0.1:3000/health; waitfor http://localhost:5173/
node $EV/vault-probe3.mjs; echo "probe3 exit $?"
echo "API log lines for /api/v1/resources: $(grep -c '/api/v1/resources' $EV/dev-F.out.txt)"
stop $P

echo; echo "## G: Troubleshooting row - Web UI alone, proxy target unreachable (default 127.0.0.1:3000, nothing listening)"
echo "listening on 127.0.0.1:3000 before G? $(ss -ltn | grep -c '127.0.0.1:3000 ')"
setsid pnpm --filter @password-manager/web dev > $EV/web-G.out.txt 2>&1 & PW=$!
waitfor http://localhost:5173/
echo "POST :5173/auth/unlock -> $(c -X POST -H 'content-type: application/json' -d '{}' http://localhost:5173/auth/unlock)"
echo "GET :5173/api/v1/resources -> $(c http://localhost:5173/api/v1/resources)"
echo "vite log proxy-error lines (verbatim):"
grep -i 'proxy error' $EV/web-G.out.txt | sed 's/\x1b\[[0-9;]*m//g'
stop $PW

echo; echo "## secret check on dev logs"
cat $EV/dev-F.out.txt $EV/web-G.out.txt | grep -ciE 'accessToken|refreshToken|synthetic-docs-check|masterPassword'
ss -ltn | grep -E '127.0.0.1:3000|:5173' || echo "all servers stopped"
