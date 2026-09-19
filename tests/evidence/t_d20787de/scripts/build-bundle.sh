#!/bin/bash
# t_d20787de — build the committed evidence bundle from the scratch measurements.
# Secret discipline: every copied file is scanned for token-shaped strings before it is staged;
# the bundle is destined for a PUBLIC repo.
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
WT=/home/sap/password-manager-check/.worktrees/t_d20787de
EV="$WT/tests/evidence/t_d20787de"
mkdir -p "$EV/readback" "$EV/drafts" "$EV/transcripts"

# 1. audits + diff
cp "$SCR/audit-t0.txt" "$EV/audit-t0.txt"
cp "$SCR/audit-t1.txt" "$EV/audit-t1.txt"
cp "$SCR/audit-diff.txt" "$EV/audit-diff.txt"

# 2. the recorded comments: drafts + the board's authoritative read-back + the diff between them
cp "$SCR/drafts/"*.md "$EV/drafts/"
cp "$SCR/readback/"*.md "$EV/readback/"
cp "$SCR/readback-diff.txt" "$EV/comment-readback-diff.txt"

# 3. transcripts of every measurement quoted in the comments
cp "$SCR/gh-facts.txt"          "$EV/transcripts/gh-facts.txt"
cp "$SCR/repo-facts.txt"        "$EV/transcripts/repo-facts.txt"
cp "$SCR/m3-m4-m6.txt"          "$EV/transcripts/master-evidence-and-r2-source.txt"
cp "$SCR/doc-refs.txt"          "$EV/transcripts/gate-doc-refs.txt"
cp "$SCR/verify-t28951254-env.txt" "$EV/transcripts/env-fingerprints.txt"
cp "$SCR/env-full-scan.txt"     "$EV/transcripts/env-and-evidence-scan.txt"
cp "$SCR/ac3-send.txt"          "$EV/transcripts/telegram-send-ac3.txt"
cp "$SCR/scan-reproduction.txt" "$EV/transcripts/scanner-reproduction.txt"
cp "$SCR/classify-token-hits.txt" "$EV/transcripts/tip-token-classification.txt"
cp "$SCR/probe-r2-branch-value.txt" "$EV/transcripts/probe-qa-t_b51a1ff3-review-r2.txt"
cp "$SCR/probe-master-evidence-value.txt" "$EV/transcripts/probe-master-evidence-file.txt"
cp "$SCR/check-drafts.txt"      "$EV/transcripts/comment-preflight-regexes.txt"
cp "$SCR/preflight.txt"         "$EV/transcripts/board-copy-preflight.txt"
cp "$SCR/snapshot-t0.txt"       "$EV/transcripts/board-snapshot-t0.txt"
cp "$SCR/snapshot-t1.txt"       "$EV/transcripts/board-snapshot-t1.txt"

# 4. prior attempt's baseline (captured 2026-09-18 22:00Z over the then-current board copy)
cp /home/sap/.hermes/kanban/workspaces/t_d20787de/evidence/audit-before-full.txt "$EV/audit-t0-baseline-2026-09-18.txt"

# 5. card dumps, before and after the verdicts
bash "$SCR/dump-cards.sh" "$SCR/board-t0.db" > "$EV/transcripts/cards-before.txt" 2>&1
bash "$SCR/dump-cards.sh" "$SCR/board-t1.db" > "$EV/transcripts/cards-after.txt" 2>&1

# 6. the scripts that produce every number above
mkdir -p "$EV/scripts"
cp "$SCR/snapshot-board.sh" "$SCR/audit.sh" "$SCR/audit-diff.sh" "$SCR/dump-cards.sh" \
   "$SCR/preflight.sh" "$SCR/readback.sh" "$SCR/gh-facts.sh" "$SCR/repo-facts.sh" \
   "$SCR/check-pointers.sh" "$SCR/doc-refs.sh" "$SCR/env-full-scan.sh" "$SCR/scan-reproduction.sh" \
   "$SCR/ac3-send.sh" "$SCR/m3-m4-m6.sh" "$SCR/classify-token-hits.py" "$SCR/verify-t28951254-env.py" \
   "$SCR/probe-ref-value.py" "$SCR/normalise-drafts.py" "$SCR/check-drafts.mjs" "$EV/scripts/"

echo "=== bundle contents ==="
find "$EV" -type f | sort | sed "s|$EV/||"
echo
echo "=== token-shaped-string self-check over the bundle ==="
HITS=$(grep -r -l -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$EV" | wc -l)
echo "files with a token-shaped match: $HITS"
