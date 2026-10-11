#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# qa-weekly-signoff-audit.sh — weekly QA sign-off gate audit, run LOCALLY by the
# Hermes cron of the `qa` profile (t_8a64c3dd, QA_SIGN_OFF_GATE.md §6.5).
#
# Installed copy: ~/.hermes/profiles/qa/scripts/qa-weekly-signoff-audit.sh
# (`cp` this file there; the cron job `qa-weekly-signoff-audit` runs it with
# no_agent=true — no LLM, deliver=local — every Monday 06:17 UTC).
#
# What it does, and what it never does:
#   * keeps its OWN clone (QA_AUDIT_STATE_DIR/clone, no checkout), fetches it,
#     and audits a THROWAWAY detached worktree of origin/master, removed on
#     exit. It never touches the shared clone /home/sap/password-manager.
#   * runs `scripts/qa/signoff-audit-local.mjs run` FROM that worktree — i.e.
#     the gate and the reporter exactly as merged on master — against the real
#     board with --fail-on-a11 (t_b102b100 is merged).
#   * the reporter attaches the report to the maintenance card, posts one
#     `AUDIT <date> : <rule>` comment per card in violation and a synthesis
#     whose first line is `AUDIT-RUN: <ISO8601>`. It never unblocks, completes
#     or reassigns a card, and sends nothing to Telegram.
#   * exit != 0 only for an operational failure (fetch, worktree, reporter
#     exit 2/3). Findings on the board are not a failure of this job.
#
# Overrides (tests / relocation): QA_AUDIT_REPO_URL, QA_AUDIT_BOARD,
# QA_AUDIT_MAINTENANCE_CARD, QA_AUDIT_STATE_DIR, QA_AUDIT_HERMES_BIN, QA_AUDIT_REF.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${QA_AUDIT_REPO_URL:-https://github.com/zeldadil/password-manager.git}"
BOARD="${QA_AUDIT_BOARD:-$HOME/.hermes/kanban.db}"
MAINT="${QA_AUDIT_MAINTENANCE_CARD:-t_9c3f521a}"
STATE="${QA_AUDIT_STATE_DIR:-$HOME/.hermes/profiles/qa/cache/signoff-audit}"
HERMES_BIN="${QA_AUDIT_HERMES_BIN:-hermes}"
# The audited revision. Production: origin/master, always. Overridden only for a
# pre-merge dress rehearsal on a fixture board (evidence of t_8a64c3dd).
REF="${QA_AUDIT_REF:-origin/master}"
CLONE="$STATE/clone"
REPORTS="$STATE/reports"

mkdir -p "$STATE" "$REPORTS"

# One run at a time (a manual `cronjob run` during the weekly tick).
exec 9>"$STATE/.lock"
if ! flock -n 9; then
  echo "qa-weekly-signoff-audit: another run holds $STATE/.lock — not started" >&2
  exit 1
fi

if [ ! -d "$CLONE/.git" ]; then
  git clone --quiet --no-checkout "$REPO_URL" "$CLONE"
fi
git -C "$CLONE" fetch --quiet --prune origin
git -C "$CLONE" worktree prune

WT="$(mktemp -d "$STATE/wt.XXXXXX")"
cleanup() {
  git -C "$CLONE" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf -- "$WT"
  git -C "$CLONE" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$CLONE" worktree add --quiet --detach "$WT" "$REF"

# Local copies of the reports: the board keeps its own (attachments are copied
# into the board's attachment store); keep 90 days here.
find "$REPORTS" -maxdepth 1 -type f -name 'qa-signoff-audit-*' -mtime +90 -delete 2>/dev/null || true

cd "$WT"
# The gate's GitHub time budget defaults to 20 s — sized for the completion
# hook's 30 s timeout. A whole-board audit reads ~20 merge commits and needs
# more: at 20 s the rehearsal of t_8a64c3dd got 13 A11 that were ALL "time
# budget exhausted", i.e. a red audit caused by its own budget. No hook timeout
# applies here, so give it 10 minutes; a real GitHub failure is still A11.
export QA_GATE_GH_BUDGET_MS="${QA_GATE_GH_BUDGET_MS:-600000}"
node scripts/qa/signoff-audit-local.mjs run \
  --db "$BOARD" \
  --repo "$WT" \
  --maintenance-card "$MAINT" \
  --out-dir "$REPORTS" \
  --hermes-bin "$HERMES_BIN" \
  --revision-label "$REF" \
  --fail-on-a11
