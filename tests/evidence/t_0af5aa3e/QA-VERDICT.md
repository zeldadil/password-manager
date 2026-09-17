# QA VERDICT — t_0af5aa3e · P0 leaked Telegram bot token (public git history)

**Verdict: `fail` — incident NOT remediated. This card must not be completed.**

- **Verifier:** `qa` profile (independent re-verification; not the remediation author)
- **Verified at:** 2026-09-17T17:28Z
- **Repo:** `https://github.com/zeldadil/password-manager` (public), default branch `master` @ `118e524`, **28 public branches**
- **Method:** fresh `git clone --mirror` of the public repo + full-history scans + live credential probe
- **Credential value is never printed in this file.** All copies referenced below are identical to
  `sha256=62fe6fe5053a50ec0570f5845ccd0ad39ea048c24239ae677c8eaa9a082e4aff` (length 46).
  (This is the previous attempt's evidence-file mistake: it wrote the raw value into a public branch. Do not repeat it.)

---

## 1. Ground truth from the public repo (fresh mirror clone, 2026-09-17T17:25Z)

| Check | Tool / command | Result |
|---|---|---|
| All-refs full-history scan | `gitleaks 8.30.1 detect --source . --no-banner --redact` | **5 findings** = 3 × `telegram-bot-api-token` + 2 × `generic-api-key` (FP, see F10) |
| Verification-based scan | `trufflehog 3.97.5 git file://<clone> --results=verified,unknown` | **3 findings, all `Verified: true`** (`TelegramBotToken`) |
| Credential liveness | Telegram `getMe` | **HTTP 200 → TOKEN IS LIVE** (bot `AASLlmHermesBot`, name `Ai-Hermes`) |

Verified findings (metadata only, values withheld):

| Detector | File | Commit | Line |
|---|---|---|---|
| `telegram-bot-api-token` / `TelegramBotToken` (verified) | `PROJECT_BRIEF.md` | `a503e4d` | 87 |
| `telegram-bot-api-token` / `TelegramBotToken` (verified) | `PROJECT_BRIEF.md` | `543c396` (**reachable from `master`**) | 87 |
| `telegram-bot-api-token` / `TelegramBotToken` (verified) | `tests/evidence/t_0af5aa3e/gitrepo-post-purge-state.md` (**the remediation's own evidence file**) | `258ca92` | 14 |

## 2. Findings

**F1 — Step 1 (rotate) NOT DONE; the credential is live.** `getMe` returns HTTP 200 for the leaked value.
Anyone may read/send as the team's bot. This is 5+ hours after the incident alert, and the whole
exposure below is moot only once the value is dead.

**F2 — Step 2 (purge) NOT DONE: the claim "purge COMPLETE (all branches), verified 0 findings" is false.**
Ground truth: **22 of 28 public branch tips** still carry the raw token in `PROJECT_BRIEF.md`, and
**24 of 28 branch histories** contain it. Only `feat/t_527d4720-runner` and
`fix/sec-incident-telegram-token` were actually force-pushed clean; the other 26 remote refs still
point at the leaked lineage.

**F3 — `master` still exposes it via history.** `543c396` (`PROJECT_BRIEF.md:87`) is reachable from
`origin/master`; only the *tip* is masked (`TELEGRAM_BOT_TOKEN=<CODE>`, PR #19). Scrubbing HEAD does not
remove a value from history.

**F4 — the master force-push block is real (architect's claim CONFIRMED).**
`gh api repos/.../branches/master/protection` → `allow_force_pushes=false`, `enforce_admins=true`,
`required_linear_history=true`. A human admin must act (lift protection + force-push, or accept the
history rewrite through another mechanism). No agent can do this.

**F5 — the remediation created a NEW public leak (highest-severity regression).**
`tests/evidence/t_0af5aa3e/gitrepo-post-purge-state.md` on public branch
`fix/sec-incident-telegram-token` (pushed tip `be10983`) contains the **full live token twice**
(lines 14 and 51) — truffleHog reports it `Verified: true` at `258ca92`. Remediation evidence that
re-publishes the secret is a regression, not progress.

**F6 — a second QA-owned leak on a public branch.** `qa/sec-incident-telegram-token` (tip `7697462`)
exposes the raw token at `PROJECT_BRIEF.md:87`. Reported here for the purge card; QA does not rewrite
history or delete remote refs unilaterally.

**F7 — `master`'s secret-scan gate is a false negative.** Master CI run **35249147289** (`118e524`)
reports `secret-scan` = **success** while a verified-LIVE credential sits in master's own history.
`master:.github/workflows/ci.yml` wires only `gitleaks/gitleaks-action@v2` (diff/PR-aware), with no
full-history truffleHog step and no `sast` job; the QA-001d wiring is unmerged (PR #12). Consequence:
incident **step 4** ("re-run the CI secret-scan job") cannot even observe the leak on the default
branch. Routed as card **t_e348e0b7**.

**F8 — PR pages expose it too.** 16 of 18 open PRs expose the token in their public diff
(14 at the head tip, 2 in commits only): PRs #1, #2, #3, #4, #6, #8, #10, #11, #12, #13, #14, #15, #16, #17
(head tip), #5 and #9 (commits only). A branch tip is not the only public surface.

**F9 — root cause of the false "verified clean" claim.** `git filter-branch --all` rewrote the
**local** `refs/remotes/origin/*` refs. The verification command used the previous session
(`git show origin/<branch>:PROJECT_BRIEF.md | grep -c <bot-id>`) therefore read *locally rewritten*
refs and could never observe GitHub. Verification of a remote purge must be done from a **fresh clone
of the remote**, and must be **present-tense**: the same command run today returns non-zero hits on
22 branches.

**F10 — advisory (not a credential).** 2 × `generic-api-key` at
`scripts/qa/signoff-gate.selftest.mjs:353` = the rule-id literal `R2_QA_VERDICT_INVALID`; a
false positive in QA's own unmerged QA-001h artifact. Not a secret; needs no allowlist while unmerged.

## 3. Step status against the incident body

| Step | Owner | Required | Verified state |
|---|---|---|---|
| 1 | HUMAN | rotate via `@BotFather`, update 6 profiles' `.env` | **NOT DONE** — `getMe` HTTP 200 |
| 2 | architect | purge from git history + force-push | **NOT DONE** — 22/28 tips, 24/28 histories, master history; 2 branches pushed; new re-leak (F5) → card **t_80fc0326** |
| 3 | product | sanitize `PROJECT_BRIEF.md` §9 | **DONE at master tip** (`<CODE>`, no token-like string) — history unchanged |
| 4 | qa | re-run CI secret-scan after rotation | **FAIL** — re-run here, 3 verified findings; master's gate cannot see them (F7) |

## 4. Reproduction (exact commands)

```sh
# 1. Fresh mirror clone of the PUBLIC repo — never verify a purge against local refs (F9)
git clone --mirror https://github.com/zeldadil/password-manager.git repo.git
git -C repo.git for-each-ref --format='%(refname)' refs/heads | wc -l     # 28

# 2. Full-history scan, all refs
gitleaks detect --source repo.git --no-banner --redact                     # 3 telegram-bot-api-token
git clone https://github.com/zeldadil/password-manager.git checkout
trufflehog git "file://$PWD/checkout" --results=verified,unknown --json     # 3 verified

# 3. Per-ref tip exposure (prints no values)
for ref in $(git -C repo.git for-each-ref --format='%(refname)' refs/heads); do
  n=$(git -C repo.git grep -c -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$ref" -- PROJECT_BRIEF.md | wc -l)
  printf '%-40s %s\n' "${ref#refs/heads/}" "$([ "$n" -gt 0 ] && echo EXPOSED || echo clean)"
done

# 4. Liveness — reads the value from git into a shell var, never echoes it
TOKEN=$(git -C repo.git show a503e4d:PROJECT_BRIEF.md | grep -oE '[0-9]{8,12}:[A-Za-z0-9_-]{35}' | head -1)
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 "https://api.telegram.org/bot${TOKEN}/getMe"   # 200 = LIVE
```

Automation for all of the above: `scripts/01-clone.sh` … `scripts/12-fingerprint.sh` (this directory),
run in order. Raw scanner reports (which contain secret material) were kept in the verifier's scratch
workspace and deliberately **not** committed.

## 5. What would change this verdict

1. `getMe` for the leaked value returns **401** (rotation done) — removes the live-credential risk.
2. A fresh mirror clone scans with **0** telegram findings across all refs, the evidence-file re-leak is
   gone, and the `qa/sec-incident-telegram-token` branch is clean (card **t_80fc0326**).
3. master's `secret-scan` is red on a leaked credential and green only when it is dead (card **t_e348e0b7**).

Until (1) and (2) hold, the card stays **fail** and must not be marked `done` (the QA sign-off gate
enforces this: `R3_VERDICT_NOT_TERMINAL`).
