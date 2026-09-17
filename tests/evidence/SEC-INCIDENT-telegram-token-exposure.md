# SEC-INCIDENT — Live Telegram bot token publicly exposed on `master`

**Reported by:** @qa (QA & Security Test Engineer)
**Date:** 2026-09-17
**Severity:** P0 — live credential, public repo, no auth required to read
**Status:** OPEN — NOT remediated

---

## Finding

The Telegram bot token for all six agent profiles is committed verbatim to
`PROJECT_BRIEF.md` **line 87 on `origin/master`** and is served by the public
`raw.githubusercontent.com` endpoint.

The token value is **not reproduced here** (redacted on purpose). It is the
`TELEGRAM_BOT_TOKEN` for the team's status-update channel.

## Evidence (reproducible)

| Check | Command | Result |
|---|---|---|
| Token on default branch | `git show origin/master:PROJECT_BRIEF.md \| sed -n '87p'` | token present |
| Public raw URL serves it | `curl -s -o /dev/null -w "%{http_code}" https://raw.githubusercontent.com/zeldadil/password-manager/master/PROJECT_BRIEF.md` | `200` |
| Token in raw body | `curl -s <raw-url> \| grep -c "8615677595"` | `1` |
| Repo visibility | `gh api repos/zeldadil/password-manager --jq '.visibility'` | `public` |
| gitleaks (full history) | `gitleaks detect --source . --redact` | `leaks found: 2` |
| gitleaks findings | rule `telegram-bot-api-token`, `PROJECT_BRIEF.md:87`, commits `a503e4d3` **and** `543c396d` | both flagged |

gitleaks exit code `1` → the CI `secret-scan` job **fails on every PR**.

## Why the reported fix did not remediate

The scrub commit `6a122c5` ("chore: scrub leaked Telegram bot token from
PROJECT_BRIEF.md decision log") exists **only on `feature/t_ee24fd37`** (PR #5,
still OPEN). `git merge-base --is-ancestor 6a122c5 origin/master` → **false**.

Result: the public `master` branch still exposes the token. The scrub on the
feature branch is correct (line 87 there reads "using the bot token from
`@BotFather`"), but it was never merged. `feature/t_ee24fd37` is also **behind**
`master` (no `ci.yml` / `pnpm-lock.yaml`), so it cannot land cleanly as-is.

## Required remediation

1. **ROTATE (owner: @user) — the only real fix.** Revoke the token via `@BotFather`,
   issue a new one. The leaked value is in permanent public git history
   (`a503e4d`); scrubbing HEAD does not undo public exposure.
2. **Scrub `master` (owner: @architect).** Re-commit the scrub on top of current
   `master` (or update PR #5 onto master) and merge. Until then the token is live.
3. **Propagate the new token** to all six profiles' `.env` / `config.yaml`
   (gitignored — correct storage).
4. **Make `secret-scan` clearable.** With `fetch-depth: 0`, gitleaks will keep
   flagging `a503e4d` after rotation. Choose one: rewrite history
   (`git-filter-repo`/BFG + force-push, needs admin override on protected
   `master`), or add a `.gitleaksignore` entry for the now-dead value, or narrow
   the scan to the PR diff range.

## Security-gate impact

Per the QA/Security role, this is a **hard blocker**: no release-track task may be
signed off while a live credential is exposed on a public branch. SEC-001 gate
enforcement: **FAIL** until steps 1–2 are complete.

## Notes

- Frontend's and architect's diagnosis of the *leak* was correct; only the
  *remediation status* was inaccurate (the scrub did not reach `master`).
- No other secret types found: gitleaks reports exactly the two findings above,
  both the same token.
