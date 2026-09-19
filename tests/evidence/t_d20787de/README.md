# t_d20787de — retro-verification of the five cards that rested on a non-QA verdict record

**Card:** `t_d20787de` (qa) — follow-up to `t_338f47fd` (§3 author rule)
**Date:** 2026-09-19
**Assignee:** `qa` · **Branch:** `qa/t_d20787de-retro-verify` · **Base:** `qa/t_338f47fd-marker-author` (PR #31)
**Gate revision used for every number here:** `scripts/qa/signoff-gate.mjs` sha256 `85dbc127b6262eb91133ddaf6c70b96cfdb9407bd26784717558f8452eafd814`
(the reviewed, unmerged revision installed in all 7 profiles; master still ships `44e15f95…`, which has no §3 author rule)

## Why this card exists

`t_338f47fd` made §3 real: a QA verdict is recorded only by a `qa`-profile comment. That fix surfaced five `done`
cards whose only verdict record was authored by another profile, plus one `qa`-assigned card that was `done`
without any verdict at all (it had been hidden behind a deferral). This card gives each of them a real QA record —
or refuses, in writing, where a verdict would be dishonest.

**Every verdict in this sweep is a retro-verification.** All six cards were already `done`; nothing here is a
verdict recorded at completion time. Each comment says so in its first paragraph, and each claim was re-measured
(CI API reads, fresh refs, local scanner runs) rather than copied from the card's own summary.

## Outcome

| card | recorded | audit before → after |
|---|---|---|
| `t_e348e0b7` truffleHog full-history in master secret-scan | `QA-VERDICT: pass` (retro) | R1+R4 → pass |
| `t_28951254` rotated token propagated to 7 profiles | `QA-VERDICT: pass-with-conditions` (retro) | R1+R4 → pass (AC5's CI run id unsubstantiated; stale branch allowlist) |
| `t_2162d273` theme-toggle / sidebar-collapse scope decision | `QA-VERDICT: pass` (retro) | R1 → pass |
| `t_527d4720` board transport for the scheduled audit | `QA-VERDICT: pass` (retro) | R1+R4 → R2 only (immutable `architect` run metadata) |
| `t_c3cb6842` gate regex fix | `QA-VERDICT: pass-with-conditions` (retro) | R1+R4 → pass; clears `t_80fc0326`'s R8 |
| `t_80fc0326` public-repo purge | **no verdict — refused in writing** | R2×3 + R8 → R2×3 only |

Board audit, same clone and same gate revision, before vs after the six comments:

```
t0: enforced 24 · pass 16 · FAIL 8   (t_7918f010, t_527d4720, t_80fc0326, t_e348e0b7, t_28951254, t_b51a1ff3, t_c3cb6842, t_2162d273)
t1: enforced 24 · pass 20 · FAIL 4   (t_7918f010, t_527d4720, t_80fc0326, t_b51a1ff3)
```

Four of the eight are cleared; `t_527d4720` and `t_80fc0326` keep `R2` rows that can only be removed by editing
history, and `t_7918f010` / `t_b51a1ff3` were out of scope. See `audit-diff.txt`.

## What was deliberately *not* done

- No card was reopened, re-completed or re-teamed; every one still carries its original `assignee` and `completed_at`.
- The gate was not touched to accommodate any of them.
- No board comment was edited or deleted. The three `R2` rows on `t_80fc0326` and the one on `t_527d4720` are
  left red on purpose: they are accurate reports about immutable records.
- The live board was read-only for this card except for the six comments it was allowed to add
  (`task_comments` ids 161–166, see `transcripts/board-copies.txt`).
- **No board copy is committed here.** The `sqlite3 .backup` snapshots used for the before/after audits stay on
  the trusted host — the privacy decision recorded for `t_527d4720` says board rows (titles, bodies, comments,
  evidence paths) must not leave it. Only their sha256 values are recorded (`transcripts/board-copies.txt`).

## Findings carried forward

1. **Loose-path verdict false positive** (the residual half of `t_c3cb6842`): `VERDICT_LOOSE_RE` still accepts `-`
   and `.` as separators, so the file name `tests/evidence/t_0af5aa3e/QA-VERDICT-ROTATION.md` cited in a code span
   is parsed as the token `ROTATION`. Reproduced in `loose-path-repro.txt`; it keeps `t_80fc0326` red.
2. **PR #31 carries a stale `QA_SIGN_OFF_GATE.md`**: its §10 item 1 re-opens the CI-audit question that
   `t_527d4720` closed — merging PR #31 as-is would revert that closure note.
3. **`fix/telegram-token-rotation-t_28951254` is stale**: after its force-push rewrite, its `.gitleaksignore`
   entry for `a503e4d` matches nothing and its history still trips gitleaks (values revoked). Prefer deleting or
   re-cutting the branch.
4. **`t_2162d273`'s decided theme writer does not exist on any ref** while FE-001d is already `done` (FE-003b is
   still `todo`) — FE-lane follow-through.
5. **No live credential anywhere** was found while re-measuring `t_80fc0326`: 13 of 40 branch tips carry a
   token-shaped string (`transcripts/tip-token-classification.txt`) and every distinct value is revoked
   (`getMe` → 401 for each, `transcripts/probe-*.txt`); truffleHog full-history over the clone reports
   `verified_secrets: 0, unverified_secrets: 0`. No new P0 card is warranted.

## Secret handling

This bundle is committed to a **public** repository and contains no secret value, no full token hash and no
token-shaped string: a regex sweep over the bundle returns 0 matches, and the transcript-generating scripts
substitute `<TOKEN-REDACTED>` for every value they print. Values are referred to by 8-character sha256 prefix
only. The one credential this card had to use live (the Telegram bot token in the profiles' `.env`) was read
into memory for a `getMe` probe and two `hermes send` calls and never printed.

## Files

| file | what it shows |
|---|---|
| `audit-t0.txt`, `audit-t1.txt` | whole-board gate audit before / after the six comments |
| `audit-t0-baseline-2026-09-18.txt` | the pre-existing baseline captured by the earlier attempt, for comparison |
| `audit-diff.txt` | per-card before/after violation sets and the FAIL-set diff |
| `drafts/`, `readback/`, `comment-readback-diff.txt` | the comments as drafted, the board's authoritative copies, and the diff (two cosmetic normalisations: `+` → `plus` in `t_2162d273`, and `.github/workflows/` stripped inside a code span in `t_527d4720`) |
| `loose-path-repro.txt` | the loose-path false positive, reproduced from the live board |
| `transcripts/gh-facts.txt` | CI run / PR / variable facts pulled from the GitHub API |
| `transcripts/repo-facts.txt`, `master-evidence-and-r2-source.txt` | master tree facts, the t_e348e0b7 evidence README, and the regex-by-regex source of the R2 rows |
| `transcripts/env-fingerprints.txt`, `env-and-evidence-scan.txt` | all 7 profiles' `.env`/`config.yaml` fingerprints, and the scanner results on the branch evidence |
| `transcripts/telegram-send-ac3.txt` | the live `hermes send` exit codes (two profiles) |
| `transcripts/scanner-reproduction.txt` | truffleHog + gitleaks re-runs of the wired command, redacted |
| `transcripts/tip-token-classification.txt`, `probe-*.txt` | every token-shaped string on the 40 remote tips and its live probe result |
| `transcripts/cards-before.txt`, `cards-after.txt` | the six cards' metadata/comments/attachments/runs before and after |
| `transcripts/board-copy-preflight.txt` | the board-copy pre-flight: the drafted comments replayed and re-evaluated before touching the live board |
| `transcripts/comment-preflight-regexes.txt` | each draft run through the gate's four verdict regexes |
| `transcripts/gate-doc-refs.txt` | which refs carry `QA_SIGN_OFF_GATE.md` and which still close §10 item 1 |
| `transcripts/board-copies.txt`, `board-snapshot-*.txt` | the board copies' identity/row counts and the comments this card added |
| `scripts/` | every measurement script used, unmodified |

## Reproduce

`bash scripts/reproduce.sh` — see the header of that file for prerequisites. It re-captures a board copy, runs
the gate over it with the reviewed revision, re-runs the per-card checks, the scanner reproduction and the
tip-token classification. The before/after pair itself needs a board copy from before the six comments were
posted (2026-09-19T07:05:45Z, copy sha256 `47355a840c6188925259da614aedb82de7af01ce9c411355d1b92eb5ceb290dc`);
with today's board the audit reproduces the *after* state.
