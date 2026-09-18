# t_338f47fd — the author rule for verdict records (`VERDICT_MARKER_RE` had no author check)

**Card:** `P1 gate defect: VERDICT_MARKER_RE has no author check` · **Owner:** `qa` · **Branch:**
`qa/t_338f47fd-marker-author` (stacked on the PR #29 head `qa/t_99e408c5-r5-quoted-path`, commit `4c0d3ea`).
**Policy:** `QA_SIGN_OFF_GATE.md` §3 (author rule), §4 (`R1`, `A7`, `A8`), §5.1, §5.4, §10 item 8, §11 changelog.
**Gate revision:** `scripts/qa/signoff-gate.mjs` sha256
`85dbc127b6262eb91133ddaf6c70b96cfdb9407bd26784717558f8452eafd814` (was `28b0b771…`, installed in all 7 profiles).

This file records no verdict token on purpose — the verdict is a comment on the Kanban card.

---

## 1. The defect

`collectVerdicts()` matched the `QA-VERDICT: <token>` **marker** in a comment from *any* author; the `QA_PROFILES`
filter was applied only to the loose (`verdict: …`) path. One comment written by `architect`, `frontend`,
`dashboard` or any other profile therefore satisfied `R1`/`R2`/`R3` on that card — and cleared the fail-closed
`kanban_complete` hook. The gate's own block text tells the worker to record the verdict *"from the qa profile"*, so
the marker path was the one path that did not enforce the gate's own premise.

It was **not** theoretical: on the live board the marker path carried **16 non-QA comment sources across 10 cards**
(`architect` ×14, `dashboard`, `human`), **7 of which were the operative verdict** on their card — and on
`t_e348e0b7`, `t_28951254`, `t_28f60dc1` and `t_2162d273` (all `done`) the architect-authored marker was what
satisfied `R1` (`non-qa-marker-inventory.txt`, BEFORE/AFTER sections). After the fix the same inventory reports the
marker count at **0** for non-QA authors; the one remaining non-QA verdict source is the deliberately
author-independent run metadata on `t_710ed14c`.

## 2. The fix

| File | Change |
|---|---|
| `scripts/qa/signoff-gate.mjs` | `collectVerdicts()` gates **both** comment paths on `QA_PROFILES.has(author)`, so a non-QA marker is not a verdict at all; `collectDeferral()` gates the `QA-VERDICT: deferred — …` marker the same way (a deferral marker is a verdict record); new `collectDiscountedVerdicts()` reports what was discounted: `A7_VERDICT_AUTHOR_IGNORED` (a marker comment from a non-QA author — **ignored**) and `A8_VERDICT_SELF_DECLARED` (the operative verdict comes from a non-QA run's metadata — **still accepted**, §3 row 3, but never silent). Both land in `--json` `facts.discounted_verdicts`. |
| `scripts/qa/signoff-gate.selftest.mjs` | 15 new cases (66 → 81): the same comment text by a non-QA author vs by `qa` (authorship is the only variable), the `blocked`-marker/R3 half of the impact, the non-QA deferral marker (R1 fires, R8 must not), the live thread shape (architect deferral + dashboard marker), the loose-path and run-metadata anti-degradation controls, and two hook-mode fires. The stale-deferral fixture (`BE-915`) is now `qa`-authored — with the author rule, a non-QA marker is not a live deferral and the ordering case would have become vacuous. |
| `QA_SIGN_OFF_GATE.md` | §3 rewritten as an author rule per verdict source (including run metadata, the one documented exception); §4 `R1` + new `A7`/`A8` rows; §5.1/§5.4 state the author requirement; §10 item 8 records the run-metadata decision; §11 changelog. |

**Deliberate scope decision (AC 1c).** Run metadata `verdict` stays author-independent — the card's acceptance
criteria freeze that behaviour, and it is the completing run's own structured handoff. The residual gap is now
**audit-visible** (`A8`) instead of silent, and the follow-up decision is routed as §10 item 8.

## 3. Acceptance criteria — how each was verified

### AC 1 — selftest cases (a), (b), (c)

`selftest-GREEN-fixed-gate.txt` — **81/81, exit 0**. `selftest-RED-prefix-gate.txt` — the **same suite against the
pre-fix gate**: 73/81, and exactly the **8** new/threshold cases are red, e.g.

```
FAIL - (a) the marker comment authored by architect does NOT satisfy R1 — exit=0 rules=[]
FAIL - (a) no verdict is collected from it at all — R2/R3 cannot fire off it either — verdict="pass"
FAIL - a non-QA `blocked` marker cannot create R3 on a done card — exit=1 rules=[R3_VERDICT_NOT_TERMINAL]
FAIL - a non-QA `deferred` marker is not a deferral: R1 fires, R8 must not — exit=1 deferral={"target":"t_b0000005","marker":true,"linked":[]} rules=[R4_EVIDENCE_MISSING]
FAIL - live thread shape (architect deferral + dashboard verdict marker) records no verdict — exit=0 rules=[]
FAIL - a non-QA marker comment does NOT clear the fail-closed hook […] — exit=0 out={}
```

Those `exit=0 rules=[]` / `out={}` lines *are* the defect: on the pre-fix gate the architect-authored marker
satisfied `R1` and the hook allowed the completion. Every pre-existing case is green on both revisions — no case was
weakened (the whole suite is the same file; only the 15 new cases are added, 8 of them falsifiable against the
prefix gate).

- (a) non-`qa` marker ⇒ **no** verdict (`facts.verdict === null`, `R1` fires, `A7` reported);
- (b) the same comment authored by `qa` ⇒ **0 violations**, `facts.verdict === "pass"` (non-vacuity control);
- (c) loose path: a `qa` loose verdict still counts; a non-`qa` loose verdict is still ignored (unchanged);
  run metadata: a non-`qa` run-metadata verdict is still **accepted** (`A8` reports it, `qa` metadata raises no `A8`).

### AC 2 — the reported fixture, replayed (`reproduce.sh`, `reproduce-output.txt`)

Fixture card `t_7918f010` (`BE-001f`, `done`, fails `R1`+`R4`), evidence path
`tests/evidence/t_5fe41426/README.md` (committed at `543c396`). Board **copy**; authorship is the only variable.

| row (comment state on the copy) | author | prefix gate `28b0b771` (installed before) | fixed gate |
|---|---|---|---|
| live state — the card's single handoff comment | (live) | `check` exit 1 · hook exit 2 | `check` exit 1 · hook exit 2 |
| comments cleared (baseline) | — | exit 1 · hook 2 | exit 1 · hook 2 |
| **one marker comment added** | `architect` | **exit 0 · hook `{}` (ALLOWED)** | **exit 1 (`R1`+`R4`) · hook exit 2** |
| the same marker comment | `qa` | exit 0 · hook `{}` | exit 0 · hook `{}` |
| control: comment stripped again | — | exit 1 · hook 2 | exit 1 · hook 2 |

The author-only difference flips the result on the prefix gate and **no longer does** on the fixed gate, and the
control is still red on both. The hook fires use the real `pre_tool_call` wire shape with `HERMES_KANBAN_DB=<copy>`;
the fixed gate's block directive names `R1_QA_VERDICT_MISSING` (full directive in `reproduce-output.txt`).

### AC 3 — `QA_SIGN_OFF_GATE.md` §3 states the author rule for every source

Every row of the §3 table now carries an **Author rule** column: marker → `qa` only; loose `qa`-comment → `qa` only
(unchanged); run metadata → *deliberately author-independent* with the reason and the `A8` visibility; deferral →
the marker `qa` only, the linked-child fallback is board state. The section also states how human overrides work
(`qa-signoff-exception:` → `X1`), not a verdict written on QA's behalf.

### AC 4 — re-installed in all 7 profiles, installed sha256 == repo copy

`install-all-apply.txt`, `installed-hashes.txt`, `verify-all-live.txt`, `hermes-hooks-doctor.txt`:

- `install-signoff-gate.sh --all --apply` → installed in `qa architect backend frontend docs product browser`;
- `installed-hashes.txt` → **all 7 == `85dbc127…`** == the repo copy;
- `verify-signoff-gate.sh --all --live` → **84 ok · 4 warn · 3 FAIL**; the 3 FAILs are the documented
  two-hooks-per-profile `hermes hooks doctor` mtime drift (`architect`, `docs`, `qa`) — identical to the pattern
  recorded on the parent card (`t_99e408c5`: 84 ok · 4 warn · 3 FAIL), see §8.1;
- **live fire of the author rule through the real dispatcher path** (`hook-live-fire-author-rule.txt`), per profile:
  `hermes hooks test pre_tool_call --for-tool kanban_complete` against a fixture card whose marker is authored by
  `architect` → **block + `R1_QA_VERDICT_MISSING`**, and the *same comment text* on the `qa`-authored card →
  **allow**. Result: **7/7 profiles blocked, 7/7 allowed**.

## 4. Live-board impact — measured, not estimated

`ab-live-audit.txt` (violation-set A/B over the same pristine board copy) and `audit-both-revisions.txt`
(enforced cards: **6 FAIL / 16 pass → 8 FAIL / 14 pass**):

| card | before | after | why |
|---|---|---|---|
| `t_e348e0b7`, `t_28951254` | pass | `R1` + `R4` | their only verdict record was an `architect` marker — they never had a QA verdict |
| `t_2162d273` | pass | `R1` | same; its evidence is an attachment, so no `R4` |
| `t_527d4720` | `R2` | `R1` + `R2` | the architect marker is discounted; only an invalid run-metadata token remains |
| `t_80fc0326` | `R2`×3 | `R2`×3 + `R8` | with the architect deferral markers discounted, the linked-child fallback fires and names `t_c3cb6842` — a `qa` card that is `done` **without** a verdict (a real, previously hidden gap) |
| `t_28f60dc1` | `R5` | clean | its `R5` was an artifact of the non-QA marker claiming a missing path; it is now adjudicated through the linked-child deferral to `t_7dd3b960` (§5.4) |
| `t_710ed14c`, `t_f49d448c` | clean | clean + `A8` / `A7`×3 | self-declared metadata and `dashboard`/`human` markers are now visible, not decisive |

43 of 49 `done` cards keep an identical violation set — the change is scoped to cards that were relying on a
non-QA record. These surfaced gaps are routed as a follow-up card (retro-verification), not silently accepted.

## 5. Residual risk / open items

1. **Run metadata is still author-independent** (§3 row 3, frozen by AC 1c) — a non-QA run can self-declare; `A8`
   makes it visible. Decision routed as §10 item 8 (`qa`, gate lane).
2. **The board is writable by the profiles themselves.** This rule removes the *quiet* path (no forgery needed, only
   the wrong author), not a hostile agent's board write — the honest scope of the whole gate, unchanged (§"What the
   gate is not").
3. `R8` now fires on `t_80fc0326` although the card carries a human `X1` exception — exceptions cover
   `R1`/`R4`/`R7` by design, and the deferral chain it names is genuinely broken (`t_c3cb6842` is `done` without a
   verdict). Reported on the card and in the follow-up; not "fixed" by widening X1.

## 6. Files

| File | What it is |
|---|---|
| `reproduce.sh` | re-runnable end-to-end reproduction: hashes → patched selftest → same suite vs the prefix gate → fixture replay (check + hook, both revisions) → pristine-copy board A/B → live-board-untouched proof → installed-hash equality (`--full` also re-installs + verifies) |
| `reproduce-output.txt` | its output (**ALL EXPECTATIONS MET**, exit 0) |
| `transcripts.sh` | regenerates the standalone transcripts below |
| `selftest-GREEN-fixed-gate.txt` / `selftest-RED-prefix-gate.txt` | 81/81 green on the fixed gate; 8 red cases on the prefix gate |
| `audit-both-revisions.txt` | board audit under both revisions on one copy (6 → 8 FAIL) |
| `ab-live-audit.txt` + `ab-live-audit.mjs` | per-card violation-set A/B with the discounting detail |
| `non-qa-marker-inventory.txt` + `inventory.sh` + `inventory-verdict-sources.mjs` | every verdict source on the board by author, BEFORE (prefix gate) and AFTER (fixed gate) |
| `gate-fix.diff` | the change (gate + selftest + policy doc) |
| `install-all-apply.txt`, `installed-hashes.txt`, `verify-all-live.txt`, `hermes-hooks-doctor.txt` | re-install, hash equality, structural + live verification, doctor transcripts |
| `hook-live-fire-author-rule.txt` | per-profile live fire of the author rule through the dispatcher path |
| `dogfood-before-verdict.txt`, `dogfood-after-verdict.txt`, `dogfood.sh` | the gate's verdict on **this** card before (2 violations) and after (0) the verdict comment |
| `own-completion-live-fire.txt` | live fire of the installed hook for this card's own completion, from the worker workspace (allowed, `{}`) |
| `verdict-comment-onboard.md` | the operative verdict comment as it reads back **from the board** (authoritative copy — the posted body may be normalised, so the board is the record) |
| `reinstall-and-verify.sh` | regenerates the four install/verify/doctor/hook-fire transcripts |
