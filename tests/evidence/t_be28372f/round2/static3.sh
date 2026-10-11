set -u
# QA round-2 static checks for t_be28372f on origin/master. Usage: bash static3.sh
export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:$PATH
cd /home/sap/.hermes/kanban/workspaces/t_be28372f/qa-clone
echo "## HEAD $(git rev-parse HEAD)"
echo "## cadaea2 ancestor of origin/master:"; git merge-base --is-ancestor cadaea23f1f701d7577255b1d75f53e86bc06240 origin/master && echo yes
echo "## docs files changed since cadaea2:"; git diff --stat cadaea2 origin/master -- README.md docs/development/setup.md; echo "(empty = none)"
echo "## stale-claim grep (README.md, docs/), outside tests/evidence:"
git grep -n -i -E "known gap|does not work yet|no dev proxy|stays on|returns 404|returns HTML|#73-web-ui--api-in-local-dev-known-gap" -- README.md docs/ || echo "0 hits"
echo "## t_76755bb3 caveat present:"
git grep -c "t_76755bb3" -- README.md docs/development/setup.md
echo "## anchor target + inbound links:"
git grep -n "^### 7.3" -- docs/development/setup.md
git grep -n "#73-web-ui--api-in-local-dev-vite-dev-proxy" -- README.md docs/ | wc -l
echo "## unbound fetch still on master (caveat still needed):"
grep -n "options.fetchImpl ?? fetch" apps/web/src/api/client.ts
echo "## prettier --check differing-line count, e4e150c vs cadaea2:"
mkdir -p /home/sap/.hermes/kanban/workspaces/t_be28372f/ev3/pp
for f in README.md docs/development/setup.md; do
  for r in e4e150c cadaea2; do
    o=/home/sap/.hermes/kanban/workspaces/t_be28372f/ev3/pp/$r-$(basename $f)
    git show $r:$f > $o
    n=$(npx prettier --stdin-filepath $f < $o | diff - $o | grep -c '^[<>]')
    echo "$r $f prettier-diff-lines=$n"
  done
done
