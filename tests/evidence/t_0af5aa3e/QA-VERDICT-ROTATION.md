# QA verdict — t_0af5aa3e · P0 leaked Telegram bot token (public git history)

**QA-VERDICT: pass-with-conditions** — verifier: `qa` profile · verified 2026-09-17T20:14–20:20Z
**Repo:** `https://github.com/zeldadil/password-manager` (public) · `master` @ `eb6044b` · **31 public branches** (was 28)
**Method:** fresh `git clone --mirror` of the public repo + full-history scans + live `getMe` probes + live CI re-run.
Never verified against local remote-tracking refs (that was the root cause of the previous false "0 findings" claim — F9 of the prior verdict).

> **No credential value appears in this document.** The leaked value is referred to by
> `sha256=62fe6fe5053a50ec0570f5845ccd0ad39ea048c24239ae677c8eaa9a082e4aff` (46 chars, "the old value").
> The rotated value is referred to only through its Telegram identity (`@AASLlmHermesBot`, bot id `8615677595`) and is not
> fingerprinted here either, on purpose: it is a live credential.

---

## 1. Headline

The **live-credential risk is closed**: the leaked value is **dead** (`getMe` → `401`) and the rotated value is **live** on the
same bot (`getMe` → `200`, `@AASLlmHermesBot`). All **31 branch tips** are clean of the string (was 22/28 exposed), the
re-leak the previous remediation created is gone, and `master`'s `secret-scan` gate goes **green for the right reason**
(no verified credential), with no allowlist anywhere.

Three conditions remain (C1–C3 below). C1 is **operational and blocking**: every agent profile still holds the *dead* token,
so the team's mandated Telegram channel is currently **down**.

## 2. Verified ground truth (fresh mirror clone, 2026-09-17T20:14Z)

| # | Check | Command / tool | Result |
|---|---|---|---|
| 1 | Leaked value liveness | `curl api.telegram.org/bot<old>/getMe` | **HTTP 401 Unauthorized → DEAD** ✅ |
| 2 | Rotated value liveness | `curl api.telegram.org/bot<new>/getMe` | **HTTP 200**, bot `AASLlmHermesBot`, id `8615677595` ✅ (same bot ⇒ `/revoke` rotated the secret, not a new bot) |
| 3 | Pattern scan, all refs | `gitleaks 8.30.1 detect --source repo.git --redact` | **2 × `telegram-bot-api-token`** (`a503e4d`, `543c396`) + 3 × `generic-api-key` (FP, F7) — was 3 telegram findings |
| 4 | Verification scan, all refs | `trufflehog 3.97.5 git file://<clone> --results=verified,unknown` | **0 findings, 0 verified** (`verified_secrets:0, unverified_secrets:0`) — was 3, all `Verified: true` ✅ |
| 5 | Branch tips exposing the string | per-ref `git grep` over `PROJECT_BRIEF.md` | **0 / 31** ✅ (was 22 / 28) |
| 6 | `master` history | `git merge-base --is-ancestor` | `543c396` **reachable from master** — the dead string is still in master's history (C2) |
| 7 | Other branch histories | as above | `fix/sec-incident-telegram-token`, `ci-t_e348e0b7-wiring-clean` also reach `543c396` |
| 8 | PR refs | `git grep` over `refs/pull/*` | **15 refs** still expose the string (14 × `*/merge`, `pull/7/head`) — dead value |
| 9 | `master` tip annotation | `git show master:PROJECT_BRIEF.md` line 87 | `TELEGRAM_BOT_TOKEN=<CODE>` — sanitized ✅ |
| 10 | Branch protection | `gh api …/branches/master/protection` | `allow_force_pushes=false`, `enforce_admins=true`, `required_linear_history=true` — **unchanged**, master history rewrite still needs a human admin ✅ (architect's claim confirmed) |
| 11 | CI after rotation (step 4) | `gh run rerun 35262427071` (master `eb6044b`) | **all 9 jobs success, `secret-scan` = success**, `sast` = success ✅ |
| 12 | Allowlist check | master tree + `ci.yml` | **no** `.gitleaksignore` / allowlist / exclusion file on master ✅ |
| 13 | Agent profiles' config | sha256 of each `.env` token | **all 7 profiles still hold the DEAD token** (C1) |
| 14 | Live channel test | `hermes send --to telegram:956145756` | **`Telegram send failed: Unauthorized`** — the notification channel is down (C1) |

CI green is honest, with one caveat stated plainly: `truffleHog git file://. --no-update --results=verified,unknown --fail`
(verified present in `master:.github/workflows/ci.yml`) passes because the value **no longer verifies** — dead values are
reported as `unverified` and that result class is excluded by the wiring. `gitleaks-action@v2` in the same job is diff-aware,
so the two residual *pattern* hits in `master` history are not what the job evaluates. The gate therefore means
"no **live** credential", not "the string is gone from history" — the string is not gone (C2).

## 3. Findings

| id | severity | finding | routing |
|---|---|---|---|
| **F1** | **closed** | Step 1 (rotate) effective: old value `401`, rotated value `200` on the same bot. Previously `fail`. | — |
| **F2** | info | Step 2 (purge) — all 31 branch tips clean; the evidence-file re-leak (`258ca92`, 2× raw value) is **gone**; `qa/sec-incident-telegram-token` rewritten clean. Architect's AC2/AC3/AC4 now verified true from a fresh mirror. | — |
| **F3** | low (residual) | The **dead** string is still reachable in public history: `543c396` from `master` (+2 branches) and **15 `refs/pull/*`** refs. Anyone reading history can still obtain the string, but it grants nothing. | C2 / card **t_80fc0326** (master part) |
| **F4** | **high (operational)** | **Agent Telegram channel down.** All 7 profiles' `.env` (architect, backend, browser, docs, frontend, product, qa) still carry the **dead** value; `hermes send --to telegram:956145756` → `Unauthorized`. Consequence: every card completion/block notification fails silently for the whole team, and step 1's second half ("update the bot token in all 6 agent profiles' `.env`") is **not done**. Also: `browser`, `docs`, `frontend`, `qa` `.env` contain **duplicate** `TELEGRAM_BOT_TOKEN` lines. | **C1** / card **t_28951254** |
| **F5** | medium (process) | **The rotated live credential was posted in cleartext in a board comment** (`dashboard`, this card, 2026-09-17T20:09Z). The board is a durable, shared artifact: the value is now in `~/.hermes/kanban.db` and is injected into **every worker's context** on this card — one careless copy into a repo file reproduces exactly the previous incident (the prior re-leak happened when an agent copied values into an evidence file). Not a public exposure *today*; no agent may copy it into any repo/evidence/log. | **C3** / card **t_b51a1ff3** |
| **F6** | info | `master` PR #23 wiring verified: full-history truffleHog step + Semgrep `sast` job present; the pre-rotation red case (`35261467319`, `secret-scan=failure`) and post-rotation green case (`35262427071`, all 9 jobs success) are both real. t_e348e0b7's green case is now claimable. | — |
| **F7** | advisory | 3 × `generic-api-key` hits at `scripts/qa/signoff-gate.selftest.mjs:353` are the rule-id literal `R2_QA_VERDICT_INVALID` (self-test fixture), not credentials. No allowlist needed. | — |
| **F8** | advisory | Local clones on this host still contain the leaked history (`/home/sap/password-manager`, `/home/sap/pm-verify`, worktrees). Harmless while the value is dead, but recreating/force-pushing any of those refs would resurrect the string on the remote. | inform |

## 4. Step status against the incident body

| Step | Owner | Required | Verified state (2026-09-17T20:20Z) |
|---|---|---|---|
| 1 | HUMAN | rotate via `@BotFather`, **update all 6 profiles' `.env`** | **rotation DONE** (`getMe` 401 for the old value, 200 for the rotated one); **`.env` update NOT done** → F4 |
| 2 | architect | purge history + force-push | **DONE for all 31 branch tips** (0/31 exposed), re-leaks removed; **master history + 15 PR refs still carry the dead string** — blocked on branch protection (human admin) → C2 |
| 3 | product | sanitize `PROJECT_BRIEF.md` §9 | **DONE** at `master` tip (`<CODE>`) |
| 4 | qa | re-run CI `secret-scan` after rotation | **DONE — green** (`35262427071`: all 9 jobs success incl. `secret-scan`, no allowlist) |

**Incident rule AR-2 ("rotate, don't just delete") is satisfied**: the credential is dead, which is what makes the residual
string worthless. The incident body explicitly allows the alternative "document it as a dead-rotated credential if purge is
infeasible" — for `master`'s history, purge is infeasible for any agent (branch protection), and it is now documented.

## 5. Conditions (tracked)

| id | condition | owner | tracked by |
|---|---|---|---|
| **C1** | Propagate the rotated token into all 7 profiles' `.env` (+ `architect/config.yaml` if it carries a token), remove duplicate `TELEGRAM_BOT_TOKEN` lines, and prove the channel works with a live `hermes send` (exit 0). **Never** paste/print/commit the value — read it programmatically from the board. | architect | **t_28951254** |
| **C2** | Rewrite `master` history to drop the dead string and clean the 15 stale `refs/pull/*` refs — requires a **human admin** to lift `allow_force_pushes`/`enforce_admins`/`required_linear_history`. Cosmetic after rotation (dead value), not a live exposure. | HUMAN + architect | **t_80fc0326** + this card's comment |
| **C3** | Board/evidence hygiene: record and mechanically enforce "no secret ever enters a Kanban comment, card body, evidence file or log — distribute via `.env`"; decide whether the value pasted in the board comment must be rotated again (QA recommendation: rotate only if board content is ever exported/shared off the trusted host; until then, treat it as exposed-once and never copy it). | architect (+ human decision) | **t_b51a1ff3** |

## 6. What could still change this verdict

1. A future push re-introducing a **live** credential → any verdict here is void; the CI gate catches that (verified red case).
2. C1 done → the operational regression is closed and the incident can be archived.
3. C2 done (or explicitly waived by the human as "dead-rotated credential, accepted") → F3 closes.

## 7. Reproduction

`reproduce.sh` (this directory) reproduces every row of §2 from scratch against the public repo; the transcript of the run
that produced this document is `transcripts-reproduce.txt`. Both contain **no** credential value: the old value is held only
in a shell variable (read from public history), the rotated value only in a shell variable read from the board DB.

Self-scan of this payload before publication: `gitleaks` → no leaks; `trufflehog filesystem --results=verified,unknown` →
`verified_secrets: 0`; raw-pattern grep → 0 hits.
