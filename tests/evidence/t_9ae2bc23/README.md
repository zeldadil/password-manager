# t_9ae2bc23 — SEC-GATE audit: done cards that passed only on a QUOTED exception key

Run 2026-10-09 by `qa`. The gate is `scripts/qa/signoff-gate.mjs`. The live board `~/.hermes/kanban.db` was only
read: `sqlite3 .backup` took one consistent snapshot, and every write went to a copy of that snapshot. The board
snapshot and the raw audit JSON are not committed (this is a public repo and the board holds free-text comments).
Their sha256 is in `inputs.sha256`.

## Gate revisions compared (blob ids checked against the extracted bytes, see `revisions.txt`)

| label | commit | blob | what it is |
|---|---|---|---|
| old  | `935b64b` (= `bd62d76^`) | `7596ff35…` | before the fix: the key counted as an exception wherever it appeared |
| fix  | `bd62d76` (t_b8001b55, PR #114) | `374566d3…` | author allowlist, never on securityTrack, ignores the key inside code |
| head | `4eac8e1` (origin/master tip at run time) | `6b277b1c…` | fix + R9/R10/§5.9 work merged since |

Selftest of the head gate: **150/150** (`selftest-master.txt`, exit 0). It ran on Node 26.7.0 because the Node 22
scratch copy had been purged. The gate has no npm dependencies, so the Node major does not change its result here.

## Criterion 3: exhaustive sweep (run first, it matters most)

`sweep.sh` → `analysis.txt`, `exit-codes.txt`, `board-facts.txt`. **All 140 `done` cards** were checked, in both
views: the default (enforced, 113 post-epoch cards) and `--strict-history` (all 140, grandfathered cards included).
The sweep was not limited to the 7 cards of the first survey.

1. **old → fix: 139 cards unchanged, exactly 1 newly failing: `t_33dcad7d`** (`[]` → `R1_QA_VERDICT_MISSING`,
   A10 × 4, all `quoted`). No card was cleared and no other card changed. This holds in both views.
2. **fix → head: 140/140 unchanged.** The later gate work moves nothing for this question.
3. **Every done card with an exception record**, either X1 in old or A10/X1 in fix/head: 8 cards.
   - `t_33dcad7d`: passed only on quoted keys. This is the one case.
   - `t_75180b28` (#551, #571) and `t_b8001b55` (#569): the keys are quoted, and the gate now refuses them (A10).
     Neither card depended on them: each has its own verdict, and has `violations=[]` in all three revisions.
   - `t_80fc0326`, `t_b51a1ff3`: X1 still applied. Both fail `R2` with or without it, so nothing hinges on it.
   - `t_930fddbe`, `t_9b3bdba0`, `t_f49d448c`: X1 still applied. See the counterfactual below.
4. **Counterfactual** (`neutralise.py`). Every exception key in a second copy was neutralised: 13 comments changed,
   and 0 comments still match `EXCEPTION_RE`. Re-running fix and head then leaves **3 cards whose outcome depends on
   an applied exception**: `t_930fddbe`, `t_9b3bdba0`, `t_b51a1ff3`. All three keys are written by `dashboard`, in
   plain text at the start of a line, and read "closed by human decision (Ze) …". These are deliberate human
   waivers, not quotations: an allowed author, outside code, on a card that is not security-track. They are applied
   as designed (§5.6) and stay visible as X1 on every audit. `t_f49d448c` does not depend on its human exception:
   its operative verdict is QA comment #98.
5. **Intent review of every occurrence of the key on a done card**: 14 occurrences on 8 cards, listed verbatim at the
   end of `analysis.txt`. Every quotation is in a code span, and the fixed gate refuses each one. Every applied key is
   a real waiver. There is no plain-text quotation that the code-span rule would miss. (The loose
   `LIKE '%signoff%exception%'` count in `board-facts.txt` finds 9 cards. The ninth, `t_430aa9a3`, has no key in the
   gate's `EXCEPTION_RE` shape.)
6. Security track: none of the 8 cards is security-track, so the `security-track` refusal path never fired.

**Result: no done card other than `t_33dcad7d` depends on a quoted (or otherwise refused) exception.**

## Criteria 1 and 2: `t_33dcad7d` judged on what is on origin/master

`verify-t_33dcad7d.sh` → `verify-t_33dcad7d.txt`. The git checks use a fresh `git clone --mirror`
(163 refs incl. `refs/pull/*`). The board was opened read-only.

The card is a decisions + routing card (its body puts code changes out of scope). It covered five items:

| # | closing claim | verified | status today |
|---|---|---|---|
| 1 | CI wiring: no board audit in CI for now; a separate qa card if wanted (→ `t_ea0783c5`) | decision sound; child created | `qa-signoff-audit.yml` on master since `6cbfb38`. All 3 scheduled runs so far are `cancelled`, a known problem tracked in `t_30d7dff5` (HUMAN) / `t_8a64c3dd`. That is outside this card's scope. |
| 2 | 26 pre-epoch cards grandfathered, "Decision recorded in PROJECT_BRIEF.md §9"; "Evidence attached: docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md" | **false when closed**: 0 commits touch that file on any ref, 0 attachments, and the `grandfather` text in `PROJECT_BRIEF.md` was first added by `3651470` (2026-10-02, t_4f872624). The file exists only untracked in a local worktree (`?? docs/decisions/`) | fixed by `t_4f872624`, which landed the durable record on master (and corrected the count to 27) |
| 3 | R7 list "correct and complete as shipped, no keyword changes" | **refuted**: the master regex still misses `AUTOFILL_REQUEST`/`AUTOFILL_RESPONSE` (`\bautofill\b` + `_`), nonce, `sender.origin` and `AES-256-GCM` (`r7-probe.mjs` output) | superseded by decision `t_18230e85` (R7 v2). The implementation is still open: `t_90a4bd73` (blocked), `t_75799b2e`, `t_f10ca03c` |
| 4 | no release-track board planned; the audit's `--db` is deferred | consistent with the board (only one board) | stands |
| 5 | Architect sign-off on TEST_STRATEGY §12 row 2 | architect's own act, not a QA deliverable | its stated basis is claim 3, which was refuted |

Verdict: **pass-with-conditions**, recorded as a `qa` comment on `t_33dcad7d`. This is a re-check made after the
fact, not a sign-off at completion time. As closed on 2026-09-17, the card would not have earned a pass: two claims
were not durable or were false, and one sign-off was later refuted. What is on master today satisfies items 1, 2 and
4, through the successor cards. The open condition is R7 v2, tracked by `t_90a4bd73`. The card's remaining scope is
already owned by other cards, so reopening it would duplicate work. The decision to reopen stays with
architect/human, as the brief requires.

Side finding, for the R7 v2 lane: `t_7dd3b960` §4.3 (line 320) and the `t_18230e85` body say `vault[\s-]*key`
"cannot match the camelCase `vaultKey`". It does match, because the regex has the `/i` flag (see the `r7-probe`
line). Adding a `vaultKey` token in R7 v2 is harmless but adds nothing. This is reported as a comment on
`t_90a4bd73`, not fixed here.

## Gate check of `t_33dcad7d` (head gate, live board, read-only)

- before the verdict: `check-t_33dcad7d-before.txt`: exit 1, `R1_QA_VERDICT_MISSING`, A10 × 4
- after the verdict: `check-t_33dcad7d-after.txt`

## Reproduce

```
git clone https://github.com/zeldadil/password-manager.git && cd password-manager
bash tests/evidence/t_9ae2bc23/sweep.sh "$PWD" ~/.hermes/kanban.db /tmp/t_9ae2bc23-sweep
bash tests/evidence/t_9ae2bc23/verify-t_33dcad7d.sh "$PWD" ~/.hermes/kanban.db /tmp/t_9ae2bc23-verify
bash tests/evidence/t_9ae2bc23/check-card.sh t_33dcad7d /tmp/check.txt
```

The board changes over time, so the card counts will move. The old→fix delta on the cards present here should not.
