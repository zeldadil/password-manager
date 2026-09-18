# t_cdd23d35 — QA review verdict: **pass-with-conditions**

**Card:** FE-001k — *a11y Tests* · assignee `qa` (review lane, run 585) · **Reviewer:** `qa` (profile `qa`)
**Reviewed head:** `feature/t_cdd23d35` @ `48f6e278abb24b7f6410837192bc53b722c1399a` (remote head re-fetched: identical)
**PR:** https://github.com/zeldadil/password-manager/pull/30 (base `feature/t_4e1b6937`) · **CI:** run `35398608361` = **10/10 checks pass** (live `gh pr checks 30`, see `ci-verified.txt`)
**Review round:** 1 — *artifact* lens (cold read of the diff, then execution), no prior `changes_requested` on this card.

---

## 1. Acceptance criterion → evidence

| AC | Evidence | Result |
|---|---|---|
| *axe-core on all routes, zero violations* | `apps/web/src/a11y/routes.a11y.test.tsx` — 10 route cases (`/login`, `/unlock`, `/vault`, `/resources/res-123`, `/folders`, `/tags`, `/settings`, `/generator`, `/`, `/no/such/route`) + the shell with the disclosure open. Lane re-run by QA in a **fresh clone**: `1 file, 19 tests passed` (`a11y-lane-verify.txt`), `pnpm test:unit` 20 files / 162 tests (`verify-lanes.txt`). | **MET** |
| "all routes" is really all routes (not a hand-picked subset) | `src/routes.tsx` declares exactly 10 route cases: `/`, `*`, `/login`, `/unlock` + 6 `AppShell` children. The sweep's `ROUTES` covers all 10, including both fail-closed guards at their resolved path (`router.state.location.pathname` asserted). No screen is missing. | **MET** |
| zero violations is not a vacuous green | Sweep asserts `violations == []` **and** `incomplete == []` plus a vacuity guard (≥20 rules graded, 11 named rules required in `passes`). Independently reproduced below (§3). | **MET** |

Supporting: `axe-core@4.13.0` resolved from the committed lockfile (`install.txt`); `tsc -b` / `eslint + prettier` clean; build `dist/assets/index-Dl8kBAdm.js` 233.68 kB (gzip 74.91 kB) — byte-identical name/size to the parent branch; `test:integration` exit 0. 14 changed files, **0 production files** (`scope.txt`). Card attachments are byte-identical to the branch (`sha256-attachments-vs-branch.txt`).

## 2. The implementer's finding is real — reproduced with an independent probe

I did not reuse `mutation-check.mjs`. `qa-probe/axe-probe.spec.tsx` (published here) calls `axe.run` directly and measures both states:

* `QA-PROBE-A` — with the harness's hit-test stub: `landmark-one-main` → **passes (1 node)**, `page-has-heading-one` → **passes (1 node)**, `incomplete: []`, 29 rules graded.
* `QA-PROBE-B` — with the stub removed: direct polyfill call throws `TypeError: document.elementFromPoint is not a function`; both rules come back **`incomplete`**, `violations: []`. That is exactly the vacuous-green state: "zero violations" while `<main>`/`<h1>` were never checked.
* axe-source confirmation (4.13.0): `isModalOpen` → `document.elementsFromPoint` (axe.js:18081-18103) → `_pollyfillElementsFromPoint` calls `document.elementFromPoint` (axe.js:20130-20171); `has-descendant-evaluate` runs the page-level rules with `passForModal` (axe.js:26962). With no modal detected the real descendant check runs — the stub is on the **strict** side, not a waiver.

## 3. QA's own mutation set (independent of the delivered `M1..M5`)

`qa-probe-harness.mjs` (published here, re-runnable) — every edit reverted in a `finally`; `git diff --stat` empty at the end (`qa-probe-mutations.txt`).

| # | Mutation | Observed | Rule that fired |
|---|---|---|---|
| Q1 | `AppShell`: `<main>` demoted to `<div>` | **FAIL** — 11 failed / 8 passed | `landmark-one-main`, `region` |
| Q2 | `index.html` loses `lang="en"` | **FAIL** — 16 failed / 3 passed | `html-has-lang` (the mirrored lang is not invented) |
| Q3 | `Sidebar` nav gets an invalid ARIA attribute (`aria-labeledby` typo) | **FAIL** — 11 failed / 8 passed | `aria-valid-attr` |
| Q4 | **new** route `/audit` (no `<h1>`) added to the route table, absent from the sweep | **PASS** — a11y 19/19 (exit 0) **and** unit 162/162 (exit 0) | *none — nothing notices* |
| — | skip-link target id dropped from `<main>` | **FAIL** — 11 failed / 8 passed | `region` |
| — | clean tree (control) | pass 19/19 | — |

Q1–Q3 and the skip-link case confirm the delivered sweep is a real sensor for app regressions, including a rule class (`aria-valid-attr`) the delivered mutation set does not touch. Q4 is the defect this card's conditions are about.

## 4. Findings

**F1 (condition → `t_782802ac`)** — route coverage is not self-checking. The sweep grades a hardcoded list; nothing ties it to `src/routes.tsx`, so a route added to the table is graded by nobody (Q4: a new `<h1>`-less route leaves **both** lanes green). At the reviewed commit the AC holds, so this is a durability defect, not an AC failure.

**F2 (condition → handoff to `t_6fabf929` QA-002 Critical Web E2E)** — `color-contrast` (WCAG 1.4.3) and `target-size` (WCAG 2.5.8) are disabled by name because jsdom has no layout/canvas. That is declared honestly, but **no browser-level axe run exists anywhere in the repo** (`playwright.config.ts` lives on unmerged PR #14; the CI `e2e` job still runs the vacuous `pnpm -r … run test:e2e` delegation), so those two AC-relevant rules are unverified. The AC's "zero violations" is therefore scoped to jsdom-evaluable rules.

**F3 (non-blocking, folded into `t_782802ac`)** — three claim/behaviour mismatches inside the deliverable: (a) `routes.a11y.test.tsx:211` is named *"declares no non-empty `<title>`…"* while its body asserts `index.html` **has** a non-empty `<title>`; (b) README §5 and the `ROUTES` comment say a new route "will not be silently covered" — measured behaviour is the opposite (Q4); (c) the `REQUIRED_PASSES` comment attributes "a skip link" to that list, but axe's `bypass` rule is `any: [internal-link-present, header-present, landmark]` (axe.js:32591-32602) and still passes with the skip link detached (`QA-PROBE-C`); the skip-link target loss is caught by `region`, not `bypass`.

**F4 (non-blocking)** — `tests/evidence/t_cdd23d35/ci.txt` records the two pre-head runs (`8ccdf87`, `d8da408`); the head's own run `35398608361` appears only in the handoff comment. Verified 10/10 here, so nothing false is claimed — evidence completeness only.

## 5. Verdict

**pass-with-conditions.** The acceptance criterion is met and independently reproduced at `48f6e27`; the two conditions are tracked as named follow-ups — `t_782802ac` (route-coverage self-check + F3 wording), `t_6fabf929` (browser-level axe for contrast/target-size). No implementation file was edited by the reviewer; all reviewer work happened in a throwaway clone, published on branch `qa/t_cdd23d35-review`.
