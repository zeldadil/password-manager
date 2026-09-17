#!/usr/bin/env bash
# Inspect the exact bytes that gitleaks flagged, with the token redacted on the fly.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
cd "$WS/repo.git" || exit 1
REDACT='s/[0-9]{8,12}:[A-Za-z0-9_-]{35}/[REDACTED-TOKEN-MATCH]/g'

echo "############ A) architect evidence file @ commit 258ca92 (gitleaks StartLine 14) ############"
git show 258ca92b8234d6dc7d41f55b39fdeb00a00c335c:tests/evidence/t_0af5aa3e/gitrepo-post-purge-state.md \
  | perl -pe "$REDACT" | sed -n '10,18p'
echo
echo "-- matching lines in that whole file (redacted): --"
git show 258ca92b8234d6dc7d41f55b39fdeb00a00c335c:tests/evidence/t_0af5aa3e/gitrepo-post-purge-state.md \
  | perl -ne 'print "$.: $_" if /[0-9]{8,12}:[A-Za-z0-9_-]{35}/' | perl -pe "$REDACT"
echo
echo "############ B) same file on the CURRENT pushed tip be10983 ############"
git show be10983:tests/evidence/t_0af5aa3e/gitrepo-post-purge-state.md 2>/dev/null \
  | perl -ne 'print "$.: $_" if /[0-9]{8,12}:[A-Za-z0-9_-]{35}/' | perl -pe "$REDACT"
echo "(no output above = current tip is clean of full-token matches)"
echo
echo "############ C) qa/sec-incident-telegram-token tip PROJECT_BRIEF.md line 87 (redacted) ############"
git show 7697462:PROJECT_BRIEF.md | perl -pe "$REDACT" | sed -n '85,89p'
echo
echo "############ D) master-history occurrence @ 543c396 line 87 (redacted) ############"
git show 543c396d8bf4289492b80066a93e8c9f51de8c2a:PROJECT_BRIEF.md | perl -pe "$REDACT" | sed -n '85,89p'
