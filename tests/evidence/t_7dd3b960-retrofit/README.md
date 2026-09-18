# QA-001i-fu1 (`t_4242bee8`) — pre-epoch retrofit: evidence

**Card:** `t_4242bee8` (QA-001i-fu1, child of `t_7dd3b960`). **Author:** `qa`. **Date:** 2026-09-18.
**Executes:** decision item 2 of `docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md` §3 — the two
non-grandfather halves of the disposition: **retro-verify 3** security/normative cards and **repair 3** stale
evidence records. The other 21 pre-epoch cards are formally grandfathered by that decision and were **not**
touched; nothing was closed that QA did not verify.

**Verdict: pass.** Both acceptance criteria hold, measured — see §3 and §4.

| input | value at capture |
|---|---|
| repo | full clone of `zeldadil/password-manager`, `origin/master` @ `94fb9de`, 41 branches fetched |
| board | `~/.hermes/kanban.db`, sha256 `83694269e9a6f6cc5f42ccda21cd68400af29a3087e7f971655d2cc666632e55` (after) |
| gate revision | `signoff-gate.mjs` sha256 `0af4a45363280c134b19662840d04e43d6214b98fca278ec75efe2f824cc8d55` — the PR #25 revision, identical to the copy installed in all 7 profiles, and the same revision the parent card's baseline used |
| epoch | `2026-09-17T15:00:00Z` |

---

## 1. What was delivered

| half | card | action | verdict recorded |
|---|---|---|---|
| A | `t_9840ccdd` SEC-001 Threat Model + Security Gate | retro-verify against the committed ADR | **pass-with-conditions** (AC-4 not met) |
| A | `t_3ca45da2` ADR-002 Overall Architecture | retro-verify against the committed ADR | **pass** |
| A | `t_08b02da9` ADR-005 Extension Bridge Protocol | retro-verify against the committed ADR | **pass** |
| B | `t_ac6a1f3f` QA-001a Test Strategy | record repair (broken evidence pointer) | `pass` (token as recorded at completion) |
| B | `t_a2cf1744` QA-001c Playwright MCP + cross-browser E2E | record repair (verdict present, no evidence pointer) | `pass-with-conditions` (token as recorded at completion) |
| B | `t_5fe41426` QA-001b CI Pipeline | record repair (deferral target's verdict landed) | `pass-with-conditions` (token inherited from the deferral target) |

One remediation card was created — **`t_816a87b5`** (architect): SEC-001 §5 still carries `| QA | (pending) | | |`,
so the card's acceptance criterion 4 ("signed off by Architect + QA, recorded in the document") is unmet. The
follow-up id is named in the `t_9840ccdd` verdict comment, which is what `R6_CONDITIONS_UNTRACKED` requires.

**Retro-verification is labelled, never disguised.** Every group-A comment opens with
`QA-VERDICT: … retro-verified 2026-09-18 against <path>@<blob-sha> (retro-verification: re-checked after the
fact, not a verdict recorded at completion time)`. Group-B comments say explicitly that they restate the token
recorded at completion and are **not** a new verdict. No comment claims a verification that did not happen.

---

## 2. Files

| file | content |
|---|---|
| `comments/<card>.md` | **the posted comment body** for each of the 6 cards — captured back out of the board, byte-for-byte |
| `comments-draft/<card>.md` | the drafts as first authored, kept for transparency |
| `comment-draft-drift.txt` | unified diff draft → posted. Four bodies differ by re-typed wording (`\|` vs `\|` escaping inside one table cell, and "created in" → "kept in"); the **posted** body is authoritative and is what the gate parses. No verdict token, card id, evidence path or condition differs |
| `verify-comments.sh` / `.txt` | proves each posted body is authored by the `qa` profile, names its comment id and timestamp, and re-diffs against the draft |
| `audit/before-strict.{json,txt}` · `audit/after-strict.{json,txt}` | the two `--strict-history` audits (criterion 1) |
| `audit/before-default.{json,txt}` · `audit/after-default.{json,txt}` | the two enforced (default) audits — recorded so the post-epoch view is not disturbed |
| `compare.mjs` / `compare-strict.txt` / `compare-default.txt` | set-level before/after diff: cleared cards, **newly** failing cards, subset proof |
| `criterion2.sh` / `criterion2.txt` | acceptance criterion 2: every evidence path in each operative verdict resolved with `git rev-list --max-count=1 --all -- <path>`, and no absolute pointer left operative |
| `digests.sh` / `digests.txt` | blob sha + sha256 of the three ADRs, the committed SEC-001 §5 sign-off block, and the "does any ref carry a real QA signature" check |
| `reach.mjs` / `reach.txt` | SEC-001 acceptance criterion 5: transitive closure of `task_links` from `t_9840ccdd` |
| `links.sh` / `links.txt` | the raw `task_links` rows behind that closure |
| `preflight.mjs` | pre-post check that each comment body yields the intended verdict token and no unintended evidence pointer, deferral marker or exception marker |
| `analyze2.mjs` / `compare.mjs` | the audit-JSON parsers used above (re-runnable) |
| `reproduce.sh` | re-runs the whole verification against a clone + the live board |
| `reproduce-run.txt` | the transcript of that re-run (rc=0, `SHA256SUMS` verified) |
| `scan-secrets.sh`, `gitleaks-retrofit.txt`, `trufflehog-retrofit.txt` | pre-push secret scan of this directory: gitleaks `no leaks found`, trufflehog 0 verified / 0 unverified across 40 files |
| `SHA256SUMS` | digests of every file in this directory |

---

## 3. Acceptance criterion 1 — `--strict-history` pre-epoch failures: **24 → 18** (at most 21 required)

```
before counts: {"done_cards":45,"enforced":18,"failures":30,"grandfathered":27}
after  counts: {"done_cards":46,"enforced":19,"failures":24,"grandfathered":27}
pre-epoch FAIL: 24 -> 18
post-epoch FAIL: 6 -> 6
cleared pre-epoch FAILs (6): t_08b02da9, t_3ca45da2, t_5fe41426, t_9840ccdd, t_a2cf1744, t_ac6a1f3f
NEWLY failing pre-epoch cards (0): NONE
subset check: after-pre-epoch-fails ⊆ before-pre-epoch-fails -> true
```

* **≤ 21: satisfied with margin (18).** The 18 are exactly the 24 minus the 6 cards this card owns; **no
  pre-epoch card newly fails**, and the cleared set is exactly the 6 targets — proved as a set operation, not by
  eyeballing.
* The retrofit view therefore still distinguishes 9 compliant pre-epoch cards (18 fail / 27 grandfathered) and
  is not vacuous.
* **Post-epoch state untouched:** the enforced default view still reports 0 pre-epoch and the same 6 post-epoch
  failures (`t_28f60dc1`, `t_527d4720`, `t_7918f010`, `t_80fc0326`, `t_b51a1ff3`, `t_c3cb6842`) — all six are
  named owners on `t_7dd3b960`'s follow-up cards and are out of scope here.
* **The arithmetic differs from the proposal, and the difference is measured.** §3.3 of the decision record
  expected the 3 retro-verifications to take 24 → 21; the 3 record repairs then take it to 18, because each of
  the three repaired cards also fails `--strict-history` at baseline and is fixed by its repair. Both readings
  satisfy "at most 21"; the measured number is 18.
* One card entered the done-audit **during** this run (`t_710ed14c`, a sibling architect card completed
  concurrently) and passes; the board is shared, which is why the before/after pair is captured as an artefact
  rather than asserted to be reproducible later.

### 3.1 One claim in the card body is half true, measured

`t_5fe41426`'s repair was expected to follow automatically from repairing its deferral target ("fixed by the
same edit"). Measured, that is only half right: repairing `t_a2cf1744` clears the card's
`R4_EVIDENCE_MISSING` ("deferral target carries a verdict but no evidence"), but **`A1_HISTORY_UNGATED` still
fires** — under `--strict-history` it needs a valid verdict *on this card* **and** an evidence pointer, and a
deferral satisfies `R1` while leaving the card's own valid-verdict list empty. The card therefore needed a
verdict record of its own, which is what the comment posts; this is recorded in the comment rather than
papered over.

---

## 4. Acceptance criterion 2 — every operative evidence path is committed

`criterion2.txt`, rc=0. For each of the 6 cards the newest (operative) verdict comment was read back from the
board and every repo-relative path in it resolved with `git rev-list --max-count=1 --all -- <path>`:

| card | operative pointer(s) | resolved at |
|---|---|---|
| `t_9840ccdd` | `architecture/adr/SEC-001-threat-model.md` | `ad01bb4` |
| `t_3ca45da2` | `architecture/adr/ADR-002-overall-architecture.md` | `ad01bb4` |
| `t_08b02da9` | `architecture/adr/ADR-005-extension-bridge-protocol.md` | `a997226` |
| `t_ac6a1f3f` | `tests/evidence/t_ac6a1f3f/README.md`, `tests/evidence/t_ac6a1f3f/`, `scripts/qa/validate-docs.mjs`, `tests/evidence/t_ac6a1f3f/doc-validation-negative-control.txt` | `332caa9` |
| `t_a2cf1744` | `tests/evidence/t_a2cf1744/README.md`, `.github/workflows/ci.yml`, PR #14 | `303caca` / `bf9da1e` |
| `t_5fe41426` | `tests/evidence/t_5fe41426/README.md`, `.github/workflows/ci.yml`, PR #7 | `543c396` / `bf9da1e` |

No operative verdict names an absolute path any more, and **no `/tmp` pointer is operative on any of the 6** —
the stale one on `t_ac6a1f3f` is retained only in the superseded comment and is now reported by the gate as the
`A5_EVIDENCE_SUPERSEDED` advisory, which is the rule behaving as designed. This is finding P2 of §3.5 of the
decision record closed on all six cards.

---

## 5. Substantive findings from the retro-verification (not just plumbing)

1. **SEC-001's acceptance criterion 4 is unmet on the committed artefact — on every ref.** The card's own
   criterion says "Signed off by Architect + QA (recorded in the document)". §5 of
   `architecture/adr/SEC-001-threat-model.md` carries `| QA | (pending) | | |` and the header still reads
   `**Status:** Signed (Architect) — Pending QA sign-off`. Of the **39 refs** that carry the artefact, all 39
   carry the pending row and **0** carry a signature (`digests.txt`). The card was completed with the gate's
   own precondition unrecorded, which is why its verdict is `pass-with-conditions` and not `pass` — softened
   nowhere. Remediation: `t_816a87b5` (architect). **Residual risk is contained:** the gate held —
   `t_16f8ad84` (BE-002a), `t_fe3b76ea` (BE-003a) and `t_83dc1b35` (BR-002a) are still `todo`/`triage`, so no
   secret-storage code was written behind an unsigned gate.
2. **SEC-001's acceptance criterion 5 holds, but only transitively.** The criterion asks for "explicit
   `--parent` dependency links" to BE-002, BE-003, BR-002, BR-003, FE-002 and FE-003. The card has **5** direct
   links; closure over `task_links` reaches 112 descendants and covers **54/54** of the named families
   (BE-002 8/8 · BE-003 11/11 · BR-002 8/8 · BR-003 7/7 · FE-002 8/8 · FE-003 12/12). Part 4 of the ADR
   explains the transitive design and that explanation is accurate — recorded as met, with the reasoning
   stated so the judgement can be argued with.
3. **ADR-002 and ADR-005 pass on content**, both with all five / all four required topics in dedicated
   sections and with §8 explicitly flagging each decision as Passbolt-inspired or original. Their `(pending)`
   QA row and `Proposed` status are **not** in their acceptance criteria, so they do not change the verdict —
   but the unsigned-ADR-set observation is reported on `t_9840ccdd` and folded into `t_816a87b5` rather than
   buried.
4. **`R6_CONDITIONS_UNTRACKED` on `t_a2cf1744` was a real gap, not only a pointer gap:** the recorded
   `pass-with-conditions` verdict named no follow-up anywhere the audit could read. The repair names
   `t_ee24fd37` and restates both conditions, which are also in the card's evidence README §3.

---

## 6. Not claimed

* **No QA signature was given to SEC-001, ADR-002 or ADR-005.** A retro-verification of a card's acceptance
  criteria is not a sign-off on the artefact; SEC-001's signature needs a QA card that reviews the document in
  full, and the two ADRs are unsigned but not in scope here.
* **No verdict was re-verified on the three group-B cards.** Their tokens are restated from the record; the
  only claim made is that the evidence pointer is now committed and resolvable.
* **The 21 grandfathered cards were not touched** — no comment, no verdict, no re-classification.
* **No gate, policy or workflow file was edited.** `signoff-gate.mjs`, `QA_SIGN_OFF_GATE.md` and
  `.github/workflows/*` are byte-identical to their pre-run state; the three post-epoch follow-ups the parent
  card routed (`t_710ed14c`, `t_18230e85`, `t_75799b2e`, `t_99e408c5`) are untouched and out of scope.
* **The post-epoch gaps are not fixed** (six cards, per-card owners on `t_7dd3b960`'s follow-ups).
* Raw board dumps are **not** committed — the repo is public and those files carry every card title, body and
  comment. Only ids, titles, rule ids and evidence paths appear here (in the audit JSONs), plus the six
  QA-authored comment bodies.

## 7. Reproduce

```bash
git clone https://github.com/zeldadil/password-manager.git /tmp/clone    # FULL clone — all refs
curl -sSfL <PR #25 raw url>/scripts/qa/signoff-gate.mjs -o /tmp/gate-pr25.mjs   # sha256 must be 0af4a453…
REPO=/tmp/clone GATE=/tmp/gate-pr25.mjs bash tests/evidence/t_7dd3b960-retrofit/reproduce.sh
```

`reproduce.sh` re-runs the after-audit, the before/after set comparison, the criterion-2 resolver, the SEC-001
link closure and the artefact digests, and verifies `SHA256SUMS`.
