set -u
# QA probe 2 run for t_be28372f: default pnpm dev, Vault timeline. Usage: bash live2.sh
export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:$PATH
EV=/home/sap/.hermes/kanban/workspaces/t_be28372f/ev
cd /home/sap/.hermes/kanban/workspaces/t_be28372f/qa-clone
unset HOST PORT API_PROXY_TARGET
echo "## node $(node --version), HEAD $(git rev-parse --short HEAD)"
setsid pnpm dev > $EV/dev-E.out.txt 2>&1 & P=$!
n=0; until curl -s -o /dev/null http://127.0.0.1:3000/health && curl -s -o /dev/null http://localhost:5173/; do n=$((n+1)); [ $n -gt 60 ] && break; sleep 1; done
node $EV/vault-probe2.mjs; echo "probe2 exit $?"
echo "API log lines for /api/v1/resources: $(grep -c '/api/v1/resources' $EV/dev-E.out.txt)"
kill -- -$P 2>/dev/null; sleep 3
ss -ltn | grep -E '127.0.0.1:3000|:5173' || echo "servers stopped"
