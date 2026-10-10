#!/usr/bin/env bash
# markdownlint master vs PR head on README.md (markdownlint-cli2 0.14.0, repo has no config)
set -u
C=/home/sap/.hermes/profiles/qa/cache/scratch/t_1708dc86/run1/clone
export PATH="/home/sap/.nvm/versions/node/v22.23.3/bin:$PATH"
cd "$C" || exit 2
ls .markdownlint* 2>/dev/null || echo "no markdownlint config in repo"
git show origin/master:README.md > /home/sap/.hermes/profiles/qa/cache/scratch/t_1708dc86/README.master.md
cp /home/sap/.hermes/profiles/qa/cache/scratch/t_1708dc86/README.master.md ./README.master-copy.md
echo "== master README.md"
npx -y markdownlint-cli2@0.14.0 README.master-copy.md > ../ml-master.txt 2>&1; echo "rc=$?"
echo "== PR README.md"
npx -y markdownlint-cli2@0.14.0 README.md > ../ml-pr.txt 2>&1; echo "rc=$?"
rm -f README.master-copy.md
grep -cE '^README' ../ml-master.txt; grep -cE '^README' ../ml-pr.txt
grep -E '^README' ../ml-master.txt | sed -E 's/^[^ ]+ //' | sed -E 's/^[0-9:]+ //' | sort > ../ml-master.rules
grep -E '^README' ../ml-pr.txt | sed -E 's/^[^ ]+ //' | sed -E 's/^[0-9:]+ //' | sort > ../ml-pr.rules
echo "== findings by rule (master | pr)"
grep -oE 'MD[0-9]+' ../ml-master.rules | sort | uniq -c
echo "--"
grep -oE 'MD[0-9]+' ../ml-pr.rules | sort | uniq -c
echo "== new-in-PR (rule+message diff, line numbers stripped)"
diff ../ml-master.rules ../ml-pr.rules && echo "none"
echo "== lines touched by PR flagged?"
git diff -U0 origin/master...HEAD -- README.md | grep -E '^@@' 
grep -E '^README.md:(19[6-9]|20[0-9]|21[0-4])[: ]' ../ml-pr.txt || echo "no findings in changed README lines 196-214"
echo "== .env.example / evidence secret scan"
gitleaks version 2>/dev/null && gitleaks detect --no-banner --source . --log-opts "origin/master..HEAD" ; echo "gitleaks rc=$?"
