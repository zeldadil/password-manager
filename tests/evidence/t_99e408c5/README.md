# t_99e408c5 — R5 no longer fails a card for a path it merely quotes about another card

**Card:** `QA-001i-fu6 (P1 gate defect)` · **Owner:** `qa` · **Branch:** `qa/t_99e408c5-r5-quoted-path` ·
**Verdict:** recorded as a comment on the card (this file contains no verdict token on purpose).
**Gate doc:** `QA_SIGN_OFF_GATE.md` §5.7 (new), §4 (`R5`/`A6` rows), §5.1–§5.3, §6, §8.1, §10 item 5, §11 changelog.

---

## 1. The defect, as reported and as reproduced

`R5_EVIDENCE_FILE_MISSING` failed a card for a path its **operative verdict merely quoted about another card**.
`t_7dd3b960` (the QA card that *reported* a broken evidence pointer on `t_28f60dc1`) was failed for
`tests/evidence/t_28f60dc1/README.md` — a path that card never claimed as its own evidence. The reporting card could
only complete by not naming the path, i.e. the gate penalised the defect report.

Root cause: `collectEvidence()` extracted **every** repo-relative/absolute path from the newest verdict comment
(`EVIDENCE_PATH_RE`, `EVIDENCE_ABS_RE`, `EVIDENCE_DIR_RE`) and tagged all of them `operative`; `R5` then resolved all
of them. There was no notion of *whose* path it is, and no code-span/fence exclusion — the same class as the deferral
marker defect fixed in `t_58280940`.

Reproduced twice in this card, on the real board, with the real comment text:

| gate revision | command | result |
|---|---|---|
| prefix `0af4a453…` (installed before this card) | `check --task t_7dd3b960 --pre-complete` on a board copy where the quoting verdict is the newest record | **exit 1**, `R5_EVIDENCE_FILE_MISSING: … tests/evidence/t_28f60dc1/README.md` |
| `t_99e408c5` revision | same board, same repo | **exit 0**, the same path downgraded to `A6_EVIDENCE_CITED` |
| `t_99e408c5` revision | `check --task t_28f60dc1` (the card that *claims* that path as its own evidence) | **exit 1**, `R5_EVIDENCE_FILE_MISSING` — enforcement intact |

Full transcripts: `ab-replay-reported-instance.txt`; the board copy is built by `reproduce.sh` step 3 and never
touches live data (the live board is **not** mutated, and no board dump is committed).

## 2. The fix — QA_SIGN_OFF_GATE.md §5.7 (policy word)

> **Naming a path is not claiming it.** `R5` resolves only the paths the operative verdict **claims** as its own
> evidence. Everything else it names is a **citation**, reported as `A6_EVIDENCE_CITED` when it is absent from the
> checkout and from every ref.

1. **Claimed evidence** — from an `Evidence:` / `Artifact(s):` / `Attachment(s):` label to the end of that label's
   paragraph (blank line, heading or table row closes it). The label of §5.1 is now **normative, not decoration**.
2. **No label in the comment** — the whole comment is the claim (legacy behaviour), *except* paths inside **code spans
   or fenced blocks**, which are documentation (pasted command, quoted template, defect transcript) — the same
   principle as the marker fixes `t_c3cb6842` / `t_58280940`. This is the "option (a) + option (b)" pair the card
   described, with (b) as the primary rule and (a) as the safety net for unlabelled verdicts.
3. **Attachments** and run-metadata `artifacts` are always claims.
4. **Citations** are never `R5`; they are resolved against the other refs only to avoid a noisy advisory.

Implementation (`scripts/qa/signoff-gate.mjs`):

* `EVIDENCE_LABEL_RE` + `evidenceLabelRegions()` — label paragraphs (labels inside code are documentation).
* `codeRanges()` — fenced blocks and inline code spans, computed once per operative comment.
* `collectEvidence()` — every pointer now carries `scope`: `claim` | `citation` | `history`
  (`operative === (scope === "claim")`, so the existing JSON consumers keep working; `scope` is also emitted in
  `facts.evidence`).
* `evaluateCard()` — `A4_EVIDENCE_OFF_TREE` for claims (a cited path that the repo holds emits nothing),
  `A6_EVIDENCE_CITED` for citations, `A5_EVIDENCE_SUPERSEDED` for history, `R5` only for claims.
* `R4` guidance and §8.1 troubleshooting text now name the label convention, so a blocked worker is told the fix.

**Deliberately not bundled:** giving `VERDICT_MARKER_RE`/`DEFERRAL_RE` the same code-span/fence exclusion (it changes
verdict *detection*, not evidence extraction). Recorded in §10 item 5 as partly decided, still open, owner `qa`.

## 3. Measurements (all re-runnable)

| Evidence | Result |
|---|---|
| `selftest-GREEN-patched-gate.txt` | **66/66 cases passed**, exit 0 (58 pre-existing + 8 new; three of the new ones are anti-degradation controls that already fired before the fix) |
| `selftest-RED-unpatched-gate.txt` | same 8 new cases against the prefix gate revision: **62/66**, the 4 falsifiable ones FAIL exactly on the defect |
| `ab-live-board-old-vs-new.txt` | `audit` on the live board, prefix → fixed: **identical violation set** (19 enforced, 6 FAIL, same rules), no new violation anywhere; advisory deltas only: `A4 6 → 4` (two cited-and-off-tree pointers no longer emit a claim advisory), `A6` appears for genuinely cited absent paths |
| `ab-live-board-old-vs-new.txt` (`--strict-history`) | same 6 FAIL cards, rule-count diff empty |
| `ab-replay-reported-instance.txt` | the reported instance: prefix **exit 1 R5** → fixed **exit 0 + A6**; control card still **exit 1 R5** |
| `install-all-apply.txt` | installer applied to all 7 profiles (config entries already present → idempotent no-op) |
| `installed-hashes.txt` | installed gate == repo gate in **7/7** profiles, `sha256 28b0b771c136413aa495d3fe33d5eb5ece2c52b53ff3d03ae0d0f1956b13c7ab` |
| `verify-all-live.txt` | `verify-signoff-gate.sh --all --live`: **84 ok · 4 warn · 3 FAIL**; live fire blocks the non-compliant fixture card (exit 2 + `action:block`) and allows the compliant one (exit 0) in every profile. The 3 FAILs are `hermes hooks doctor` reporting **2 `script modified since approval` warnings per profile** — every profile runs *two* hooks (`qa-signoff-gate.sh` + the pre-existing `secret-guard.sh`) and the verifier tolerates one; the approval refresh is interactive-only and cannot be done from a headless worker. Both entries show `exists and is executable`, `allowlisted`, `produced valid JSON`. Documented as expected in `QA_SIGN_OFF_GATE.md` §8.1. |
| `reproduce-output.txt` | `bash tests/evidence/t_99e408c5/reproduce.sh` end to end → exit 0, **all expectations met** |
| `gate-fix.diff` | the code/selftest/doc delta against the prefix revision (20 hunks); scanned for secret-shaped lines: none |

## 4. Selftest cases added (`scripts/qa/signoff-gate.selftest.mjs`, section `1c`)

| Fixture | Assertion |
|---|---|
| `QA-920` `QUOTED_PATH_REPORT` — the reported instance verbatim in shape: a labelled own artifact **plus** a prose citation and a fenced transcript quoting `t_fffffff1`'s absent path | exit 0, no `R5`, no `R4`; the quoted path reported as `A6_EVIDENCE_CITED` with `scope: "citation"`; the card's own labelled path stays `scope: "claim"`, `exists: true` |
| `QA-921` `QUOTED_PATH_PRESENT` — cites another card's artifact that exists | exit 0, no `R5`, and **no** `A6`/`A4` noise |
| `QA-924` `NOLABEL_CODESPAN_MISSING` — no label, absent path only inside a code span | exit 0, no `R5`, `A6` fires (the unlabelled fallback) |
| `QA-922` `LABELLED_MISSING` — *control*: labelled own evidence absent | **`R5` still fires** |
| `QA-923` `LABELLED_MISSING_CODESPAN` — *control*: labelled own evidence absent, written in backticks | **`R5` still fires** (the fix is not "ignore backticks") |
| `QA-925` `NOLABEL_PROSE_MISSING` — *control*: no label, missing path in plain prose | **`R5` still fires** (no-label comments are still read as claims) |

## 5. Files in this change

| Path | Change |
|---|---|
| `scripts/qa/signoff-gate.mjs` | the fix (claim/citation scoping, `A6`, code-span/label parsing) |
| `scripts/qa/signoff-gate.selftest.mjs` | 8 new checks |
| `QA_SIGN_OFF_GATE.md` | §5.7 policy, §4 rules table, §5.1/§5.3, §6 counts, §8.1, §10 item 5, §11 changelog |
| `scripts/qa/hooks/*` | enforcement tooling brought onto this lane verbatim (installer, verifier, patcher, hook entry) — the gate had never landed on `master` |
| `tests/evidence/t_99e408c5/*` | this evidence set |
| `tests/evidence/{t_430aa9a3,t_5455942d,t_58280940}/*` | the evidence of the two gate lanes this branch consolidates (taken verbatim from their branches) |

Provenance of the two file groups taken from other lanes (documented because the commits are not ancestors of this
branch, which is based on `master`):

* `scripts/qa/signoff-gate.mjs`, `scripts/qa/signoff-gate.selftest.mjs` ← `origin/qa/t_58280940-r8-stale-deferral`
  (`0e7a3a3`), the newest gate revision and the one installed in all 7 profiles (`0af4a453…`).
* `QA_SIGN_OFF_GATE.md`, `scripts/qa/hooks/`, `tests/evidence/t_430aa9a3/`, `tests/evidence/t_5455942d/` ←
  `origin/qa/t_5455942d-gate-fix` (`aba5613`), the newest revision of the policy doc and the only lane carrying the
  installer/verifier.

## 6. How to re-run

```
bash tests/evidence/t_99e408c5/reproduce.sh          # hashes, selftest, prefix-gate A/B, live replay + control, hash equality
bash tests/evidence/t_99e408c5/reproduce.sh --full   # + installer apply and verify-signoff-gate.sh --all --live
```

## 7. Routing / open items (nothing silently dropped)

1. **`QA_SIGN_OFF_GATE.md` §10 item 5 — marker regexes and code spans:** still open, owner `qa` (gate lane). The
   evidence side is decided by §5.7; the *marker* side (`VERDICT_MARKER_RE`/`DEFERRAL_RE`) has the leading-boundary
   guard but no code-span/fence exclusion.
2. **Cross-PR hotspot (`scripts/qa/signoff-gate.mjs`, `QA_SIGN_OFF_GATE.md`):** this branch consolidates the gate
   lane — it becomes a superset of PR #16 (`feature/t_430aa9a3`) and PR #25 (`qa/t_58280940-r8-stale-deferral`), so
   those two PRs should be reviewed as included here rather than merged separately afterwards. `t_75799b2e` (R7 v2)
   and any other card touching the gate must rebase on this revision, not re-derive the regex block (§ the card's own
   coordination note).
3. **Doc divergence on the CI lane:** the copies of `QA_SIGN_OFF_GATE.md` on the PR #17/#18 lane
   (`qa/t_0af5aa3e-verdict`, `feat/t_527d4720-runner`) carry a **CI-job paragraph** and a §10 item 1 closure that the
   `t_5455942d` revision used here does not contain (that lane forked before the `t_5455942d` doc). A merge must take
   the union — this branch does not decide the CI text (the `architect` owns `ci.yml`).
4. **`t_28f60dc1`'s own `R5` failure is untouched and correct** — its verdict *claims* `tests/evidence/t_28f60dc1/README.md`
   (a labelled claim, absent from every ref). Repairing that record is the architect's, routed on `t_4f872624`.
5. **Hygiene:** no secret value appears in any artifact; the raw board DB copy used for the replay lives in a temp dir
   and is not committed; the live board was only ever read.
