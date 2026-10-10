# t_90a4bd73 — R7 security-track classification v2 (scope-driven)

Card `t_90a4bd73` (QA-001i-fu5a), split by the architect out of the umbrella card `t_75799b2e`. The decision it
implements is `t_18230e85`, option C. The record is committed in this PR as
[`docs/decisions/ARCH-DECISION-t_18230e85.md`](../../../docs/decisions/ARCH-DECISION-t_18230e85.md). It is a
byte-identical copy of attachment 146 on `t_18230e85`, sha256
`aaa3a94d0175147a101039e98084c97c49839bd9f24f8db97704f2680af82fa1`. It is committed unmodified, so the hash
still matches. Its §5 "qa:" line was written by architect. The real qa half of the dual sign-off is the
`QA-VERDICT: pass` comment by `qa` on `t_18230e85` (2026-10-05 12:33 UTC). `QA_SIGN_OFF_GATE.md` §5.5 says so.

Base: `origin/master` @ `626feb7`. All outputs below were produced on branch head `4960b8e` with Node 22.23.3
(CI's major version).

**Author ≠ reviewer.** I (qa) wrote this change to the gate, so I do not give the QA verdict on it (card
body, "Interdits"). The verdict and the merge belong to the architect and to an independent reviewer.

## 1. Acceptance criteria → where each one is met

| # | criterion | where |
|---|---|---|
| 1 | `SECURITY_TRACK_RE` replaced by the scope-driven classification. `autofill` and the `bridge-*` word-boundary misses are fixed | `scripts/qa/signoff-gate.mjs`: `SCOPE_V2_TOKENS`, `SECURITY_TRACK_RE`, `isSecurityTrack()`; R7 in `evaluateCard` |
| 2 | non-vacuity selftest cases (a)–(d), each failing when the v2 rule is removed | `scripts/qa/signoff-gate.selftest.mjs` section **2b** (R7v2 (a)…(k)) and **2c**. Proof that they are non-vacuous: [`mutation-check.txt`](mutation-check.txt), [`red-vs-base-gate.txt`](red-vs-base-gate.txt) |
| 3 | before/after table of `audit --strict-history`, committed here, plus attachment 146 as the decision record | [`before-after.md`](before-after.md), [`before-after-no-epoch.md`](before-after-no-epoch.md), [`run-log.txt`](run-log.txt); `docs/decisions/ARCH-DECISION-t_18230e85.md` |
| 4 | PR on `master`, CI green, card in `review` with the PR number | see the PR. The merger checks `git show origin/master:scripts/qa/signoff-gate.mjs` |

## 2. What changed in the gate

1. **Classification (decision §3).** `SCOPE_V2_TOKENS` lists the boundary tokens. Each group carries its
   ADR reference: ADR-002 §5.1–§5.5 and ADR-005 §2.1/§3/§5/§9.2/§9.3. A card is security-track when
   `scope-v2 ∧ ¬qa`. The `security` Test-Type AND is gone. The `qa` assignee exemption stays.
2. **Word-boundary fixes.** Tokens no longer end in `\b`, and separators accept `_`. Selftest cases
   (b), (e) and (e2) cover what is now matched: `AUTOFILL_REQUEST`, `bridge messages`, `bridge_message`
   and `crypto boundaries`. The last one is the wording of the ADR-002 card `t_3ca45da2`. The regex
   measured in 2026-09 (`tests/evidence/t_7dd3b960/r7-variants.mjs`) missed that card too.
3. **Tokens added or changed relative to the 2026-09 measured regex.** The decision record §3 lists the
   final boundary. The measured regex (§4.4 of the s10 record) did not contain all of it. These tokens
   were added:
   - `sub-key`, `randomBytes` and `VAULT_SEARCH`: decision §3;
   - `getRandomValues`: ADR-002 §5.4, the RNG row of §4.1;
   - `sender.origin`: §4.1 row "origin validation (`sender.origin`, allowed origin)", and a confirmed miss
     in the `t_9ae2bc23` finding on this card.

   The `vaultKey` camelCase case is **not** counted as a fix. `/i` already made v1 match it
   (`t_9ae2bc23` finding).
4. **False-positive guards, measured on the live board.** A bare `nonce` matched French "annonce" and
   "Énoncer" on `t_7e1cea21` and `t_46c18784`. Both are false positives. `nonce` now must not be preceded
   by a letter or digit (`(?<![\p{L}\p{N}])`, regex flag `u`). `vault key`, `master key` and `sub-key` no
   longer match `…keyboard`. Selftest case (k) covers both guards. A manual review of every remaining
   match on the live board (44 + 1 cards, context excerpts kept in scratch and not committed because
   they quote card bodies) found every hit inside the crypto or bridge boundary.
5. **Cut-over `R7_V2_EPOCH_ISO` (2026-10-12T00:00:00Z), flag `--r7-v2-epoch-iso`. Needs the architect's
   decision, see §3.**
6. **Defect found and fixed: `--json` output truncated on a pipe.** `audit --json` / `check --json` wrote
   the whole document with one `console.log` and then called `process.exit()`. On a pipe, everything
   beyond the 64 KiB buffer was dropped. `audit --json | wc -c` on the selftest board gave exactly
   `65536`. The selftest itself crashed in section 3 (`Unexpected end of JSON input`) as soon as this
   change added 9 fixture cards. Fix: `writeThenExit()` exits from the write callback. Selftest case 2c
   uses a deliberately slow reader and makes the old failure deterministic. The scheduled workflow is not
   affected: it uses `--json-out FILE`, and its text report is many small writes. Any `--json | jq`
   consumer was affected. Under the "consolidate gate-defect discoveries" rule this is recorded here and
   on the card, not on a new card: the fix is 10 lines and blocked this card's own selftest.

## 3. The point the architect has to decide: the cut-over epoch

Decision §1 adopted option C on a measured premise: *"the 3 `done` cards it newly flags are pre-epoch →
grandfathered advisory, **no retroactive cliff**"*, and §4.4 of the s10 record says *"only open cards
acquire a new obligation, which is the point."* That was true of the 129-card board of 2026-09-18. On
today's board (221 cards) it is false. Scope-v2 applied to every post-gate-epoch card would turn **11
already-completed cards red** (R7). They were all completed under v1, which never asked them for an
Architect sign-off. See [`before-after-no-epoch.md`](before-after-no-epoch.md): FAIL 49 → 57, R7 0 → 11.
Several of them are architect-owned specification cards.

To keep the decision's premise, the implementation adds a cut-over:

- open cards, and cards completed at or after `R7_V2_EPOCH_ISO`: **scope-v2**, R7 enforced;
- a card completed before the epoch that **v1** classified: still enforced. v2 never removes a v1
  obligation (selftest (h), mutant M6);
- a card completed before the epoch that **only v2** classifies: new report-only advisory
  `A17_R7_SCOPE_V2_UNGATED`, never a violation (selftest (g), mutant M5).

With the cut-over ([`before-after.md`](before-after.md)), FAIL stays at 49 → 49 and R7 at 0 → 0. 21
audited cards are now security-track (was 3), and 15 carry `A17`. The cut-over is my implementation
choice in service of the decision's stated intent, not a decision I can make alone. **Architect: confirm
the cut-over, or choose no epoch (`R7_V2_EPOCH_ISO` = the gate epoch) and own the 11 red cards.** The date
must not fall before the merge. Move it if the merge happens later.

## 4. Results (Node 22.23.3, head `4960b8e`)

| run | result | file |
|---|---|---|
| selftest | **222/222** (was 207; +15: R7v2 (a) (b) (c1) (c2) (d) (e) (e2) (f) (k) (g) (h) (i) (j), the NaN-epoch refusal, and the slow pipe) | [`selftest.txt`](selftest.txt) |
| new selftest vs the **base** gate `626feb7` | 11 of the 15 new cases FAIL. The 4 guards pass on v1 as designed: (c2), (f), (k), (h). The base gate then crashes in section 3 on the truncated pipe | [`red-vs-base-gate.txt`](red-vs-base-gate.txt) |
| mutation check, 8 mutants plus a control | **every expectation met**: each new case is `ok` on the real gate and `FAIL` on the mutant that removes what it guards | [`mutation-check.txt`](mutation-check.txt) |
| `audit --strict-history`, live board `~/.hermes/kanban.db` snapshot, before vs after | exit 1 → 1 (49 pre-existing FAILs, none introduced); classification table over all 221 cards | [`before-after.md`](before-after.md), [`run-log.txt`](run-log.txt) |
| same, counterfactual without the cut-over | FAIL 49 → 57, R7 0 → 11 | [`before-after-no-epoch.md`](before-after-no-epoch.md) |

The mutants:

| mutant | what it removes | cases that must fail |
|---|---|---|
| M1 | v1 classification restored | (a), (b), (c1), (d), (e), (e2), (g), (i), (j) |
| M2 | option B: token OR `security` Test Type | (c2), (k) |
| M3 | the `¬qa` exemption | (f) |
| M4 | `writeThenExit`, i.e. no flush | slow pipe |
| M5 | the cut-over epoch | (g) |
| M6 | v1 obligation kept before the epoch | (h) |
| M7 | the bare `nonce` / `vault key` guards | (k) |
| M8 | the NaN-epoch refusal | unparseable epoch |

Case (c) of the umbrella card ("`Test Types: security` and no boundary token must **not** fire") cannot
fail on v1, because v1 does not fire on it either. It is kept as guard (c2) against option B, and proven
by M2. The non-vacuous half of (c) is (c1). That is the BR-001f "Origin Validation" shape, which the
decision (§2) puts in scope. It fires on v2 and not on v1.

## 5. Reproduce

```bash
node scripts/qa/signoff-gate.selftest.mjs                      # 222/222
node tests/evidence/t_90a4bd73/mutation-check.mjs              # RESULT: every expectation met
bash tests/evidence/t_90a4bd73/red-vs-base-gate.sh             # 11 FAIL on the base gate
bash tests/evidence/t_90a4bd73/run-audits.sh ~/.hermes/kanban.db "$TMPDIR/r7"   # tables + run log
```

`run-audits.sh` takes a consistent `sqlite3 .backup` snapshot and runs all three audits on that one snapshot.
It writes the raw board snapshot and raw audit JSON to the out-dir only. They are not committed (public
repo, `t_7dd3b960` hygiene rule). The committed tables carry ids, status, assignee, titles and token
*names* only.

## 6. Not in this card

- Re-installing the gate in the 7 profiles and checking SHA-256 equality: `t_f10ca03c` (child card).
  Until then, the installed hook still runs v1.
- The QA verdict on this gate change: not by its author (see the top of this file).
