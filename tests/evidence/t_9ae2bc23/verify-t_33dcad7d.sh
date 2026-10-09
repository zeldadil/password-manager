#!/usr/bin/env bash
# t_9ae2bc23 — criterion 1: re-verify, from fresh sources, what t_33dcad7d actually
# delivered on origin/master (not what its closing comments say).
# Usage: bash verify-t_33dcad7d.sh <repo-clone> <live-board.db> <scratch-dir>
set -u
REPO="$1"; LIVE="$2"; S="$3"
mkdir -p "$S"
MIRROR="$S/mirror.git"
[ -d "$MIRROR" ] || git clone -q --mirror https://github.com/zeldadil/password-manager.git "$MIRROR"
git -C "$MIRROR" fetch -q --prune origin '+refs/*:refs/*'
echo "== fresh mirror: $(git -C "$MIRROR" for-each-ref | wc -l) refs (incl. refs/pull/*), master=$(git -C "$MIRROR" rev-parse refs/heads/master)"

echo "== claim: decision artifact docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md committed"
echo "   commits touching it on ANY ref: [$(git -C "$MIRROR" rev-list --all -- docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md | wc -l)]"
echo "   commits touching tests/evidence/t_33dcad7d/ on ANY ref: [$(git -C "$MIRROR" rev-list --all -- tests/evidence/t_33dcad7d | wc -l)]"
echo "   card attachments dir: $(ls ~/.hermes/kanban/attachments/t_33dcad7d 2>&1 | head -1)"
echo "   attachment rows on the board: $(sqlite3 -readonly "$LIVE" "SELECT count(*) FROM task_attachments WHERE task_id='t_33dcad7d'" 2>&1)"
echo "   path named in its completion artifacts exists? $(test -e /home/sap/password-manager/.worktrees/t_430aa9a3/docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md && echo yes || echo no)"

echo "== claim: pre-epoch grandfathering 'recorded in PROJECT_BRIEF.md §9' (card completed 2026-09-17)"
echo "   commits on master adding 'grandfather' to PROJECT_BRIEF.md (oldest first):"
git -C "$MIRROR" log --reverse --format='     %h %ad %s' --date=short -S grandfather refs/heads/master -- PROJECT_BRIEF.md
echo "   PROJECT_BRIEF.md 'grandfather' lines on master:"
git -C "$MIRROR" show refs/heads/master:PROJECT_BRIEF.md | grep -n -i 'grandfather' | cut -c1-160 | sed 's/^/     /'

echo "== decision 1 (CI wiring -> child t_ea0783c5): workflow on master"
git -C "$MIRROR" log --reverse --format='     %h %ad %s' --date=short refs/heads/master -- .github/workflows/qa-signoff-audit.yml | head -3
gh run list -R zeldadil/password-manager --workflow qa-signoff-audit.yml --limit 3 --json databaseId,event,conclusion,createdAt --jq '.[] | "     run \(.databaseId) \(.event) \(.conclusion) \(.createdAt)"' 2>&1

echo "== decision 3 (R7 'correct and complete, no keyword changes'): regex probe on master"
git -C "$MIRROR" show refs/heads/master:scripts/qa/signoff-gate.mjs > "$S/gate-master.mjs"
node "$(dirname "$0")/r7-probe.mjs" "$S/gate-master.mjs" | sed 's/^/     /'

echo "== successor cards that took over t_33dcad7d's open scope (board, read-only)"
sqlite3 -readonly "$LIVE" "SELECT '     '||id||' '||status||' '||assignee||' '||substr(title,1,100) FROM tasks WHERE id IN ('t_ea0783c5','t_527d4720','t_7dd3b960','t_4f872624','t_18230e85','t_75799b2e','t_90a4bd73','t_f10ca03c') ORDER BY created_at"
echo "== qa-authored comments on t_33dcad7d: $(sqlite3 -readonly "$LIVE" "SELECT count(*) FROM task_comments WHERE task_id='t_33dcad7d' AND author='qa'")"
