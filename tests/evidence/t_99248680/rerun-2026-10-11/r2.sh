set -u
export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:$PATH
W=/home/sap/.hermes/kanban/workspaces/t_99248680
cd $W/repo
echo "## rerun $(date -u +%FT%TZ) node $(node --version) HEAD $(git rev-parse --short HEAD) master $(git rev-parse --short origin/master)"
echo "## diff of app code vs origin/master (expect none outside tests/evidence/t_99248680)"
git diff --stat origin/master -- . ':!tests/evidence/t_99248680'
cd apps/web
npx vitest run dev-proxy.test.ts > $W/vitest-r2.txt 2>&1; echo "vitest exit $?"
grep -E "Tests |✓ dev-proxy" $W/vitest-r2.txt
cd $W
bash mut.sh > $W/mutation-r2.txt 2>&1; echo "mut.sh exit $?"
grep -E "Tests |exit" $W/mutation-r2.txt
bash live.sh default > $W/live-default-r2.txt 2>&1; echo "live default exit $?"
bash live.sh port3301 3301 > $W/live-port3301-r2.txt 2>&1; echo "live 3301 exit $?"
grep -E "RESULT|harness exit|migrate exit|unlock|servers" $W/live-default-r2.txt $W/live-port3301-r2.txt
sha256sum $W/vault-after-unlock-default.png $W/repo/tests/evidence/t_aeb2617e/vault-after-unlock.png
