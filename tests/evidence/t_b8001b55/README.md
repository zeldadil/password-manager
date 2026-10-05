# t_b8001b55 — QA signoff exception: author allowlist, never on securityTrack, code-span aware

Base: `origin/master` @ `783be28` (the card names `7b0d392`; the only commit between the two is
`783be28`, which touches `tests/evidence/t_19128fb2/README.md` alone, not the gate).
Author: `qa` (run 1019, 2026-10-05). This is the **author's** evidence. Per the card, an independent
`architect` verification is required before merge. This README does not stand in for it.

## The change

`scripts/qa/signoff-gate.mjs`:

| Before | After |
|---|---|
| `findException` takes the first comment whose body matches `EXCEPTION_RE`, whatever its author. | An exception applies only if its author is in `EXCEPTION_AUTHORS` = `human`, `dashboard`, `user`, `architect`, `qa`. `worker` is refused, with an advisory saying it names no profile. |
| A key inside `` `…` `` or a fenced block counts as an exception. | Each occurrence is checked with `codeRanges`. A comment where every occurrence is quoted counts as a citation and is refused. |
| On a security-track card, any exception waives R1, R4 and R7 (`&& !exception` on the R7 line). | `securityTrack` is classified before the exception lookup. On such a card every exception is refused. R7 no longer reads `exception` at all. |
| `.find()` keeps the first match, so an earlier record cannot be overridden. | The first record that passes all three checks is the one applied. Refused records earlier in the thread do not hide it. |
| A refused record is silent. | Each refused record raises the advisory `A10_EXCEPTION_IGNORED` and is listed in `facts.exceptions_ignored` as `{author, reason, why: author|quoted|security-track}`. |

`QA_SIGN_OFF_GATE.md` adds an `A10` row and qualifies the `X1` row in §4. It drops the statement that
an exception clears an R7 false positive (§5.5) and adds the three conditions to §5.6.

**Scope decision the reviewer should check:** on a security-track card the exception is refused
**as a whole**, so R4 (evidence) applies again as well as R1 and R7. The card names only R1 and R7.
R4 follows from R1: a QA verdict needs evidence, so letting an exception waive R4 alone would make no
sense.

## Selftest: the 4 acceptance cases (`scripts/qa/signoff-gate.selftest.mjs`, section 1f)

| # | Case | Fixture card(s) |
|---|---|---|
| 1 | non-allowed author is ignored: R1 and R4 fire, A10(author), no X1 | `backend` and `worker` (the `worker` advisory says it names no profile) |
| 2 | a key between backticks is ignored | **live comment #551 of t_75180b28, verbatim** (`scripts/qa/fixtures/t_75180b28-comment-551.md`, sha256 `d031e5a4…9068eba`, 3512 bytes, exported with `sqlite3 writefile()` from the board); a fenced block; non-vacuity: a quoted key plus a real one in the same comment, where the real one is applied; ordering: a refused record followed by an allowed one, where the allowed one is applied |
| 3 | security-track card: R7 **and** R1 (and R4) still fire | exceptions by `dashboard`, `architect` and `qa` on one crypto card; also hook mode: `kanban_complete` is blocked with exit 2 |
| 4 | non-vacuity: an allowed author on a non-security card is still valid | one card each for `architect`, `qa`, `human`, `dashboard` and `user`: 0 violations, X1 raised, no A10 |

### GREEN: new gate, Node 22 (the CI version, `/usr/bin/node` v22.23.2)

`selftest-node22.txt`: **107/107 cases passed**, exit 0. 93 of these were the cases that already
existed. The new section 1f adds 14 cases.

### RED: the same new selftest against the **old** gate (`git show origin/master:scripts/qa/signoff-gate.mjs`)

`selftest-red-old-gate.txt`: **98/107**, exit 1. All 9 failures are new cases from criteria 1–3. One
line in particular: on the old gate, `hook` returned `{}` (exit 0), so it **allowed** completion of a
crypto card that had neither an Architect sign-off nor a QA verdict. The 5 non-vacuity cases (4) pass
on both gates, as expected for controls. This run shows the tests are not vacuous.

## Live board delta (read-only, `~/.hermes/kanban.db`, 2026-10-05 ~14:35 UTC)

`occurrences.jsonl` lists every comment that matches `signoff%exception`, with each regex hit and
whether it falls inside code. `before.jsonl` and `after.jsonl` are `signoff-gate.mjs check --json` on
each such card, run with the old gate and then the new one (`live-delta.sh`).

| Card | Status | Before | After |
|---|---|---|---|
| t_75180b28 | triage | X1 by architect: `` ` n'a aucune contrainte d'auteur `` (the #551 quote) | X1 gone, A10(quoted). The remaining R5 has nothing to do with this card. |
| **t_33dcad7d** | **done** | X1 by architect: `` ` marker — both mechanisms exist… `` | **X1 gone, 4×A10(quoted), R1 now fires.** |
| t_80fc0326, t_9b3bdba0, t_b51a1ff3, t_930fddbe | done | X1 by dashboard | unchanged (allowed author, unquoted key) |
| t_f49d448c | done | X1 by human | unchanged |
| t_430aa9a3, t_2bb5f1f2 | — | no regex match (LIKE-only) | unchanged |

**Correction to the card body's measurement.** The card says "6 of the 7 cards carry keys from
legitimate authors; only t_75180b28 carries the stray key". In fact **2** cards have only a quoted
key: t_75180b28 and **t_33dcad7d**. All 4 architect occurrences on t_33dcad7d (comments 30–33) are
inside backticks, and architect's own comment 33 (2026-09-17) already called that X1 "a false
positive". The new gate therefore reports R1 on t_33dcad7d. That card was completed at 15:08:57,
after the epoch, with no QA verdict. This is a true positive. It shows up once the fix lands, and it
belongs to the sibling "delta measurement" card. It does not block this fix.

The regex count also settles the 10-vs-11 discrepancy. There are **11 regex hits in 10 comments on 7
cards**: 4 on t_33dcad7d, 2 in #551, and 5 on human surfaces. The `qa` comments (28, 98, 552, 554)
match the SQL `LIKE` but not the regex, so none of them is a `qa` exception.

## Other checks

- `gitleaks detect --no-git --source scripts/qa`: no leaks.
- `scan-test-data.mjs`: 13 findings, the same 13 on unmodified `origin/master` (pre-existing,
  CLAUDE.md pitfall 7). None is in a file this change touches.
- `validate-docs.mjs`: PASS.
