# FE-001k-fu (t_782802ac) — the a11y sweep's route coverage is now self-checking

**Task:** FE-001k-fu — *"make the a11y sweep's route coverage self-checking (+ two false doc/spec claims)"*
**Branch:** `feature/t_782802ac` (base: `feature/t_cdd23d35` @ `48f6e27`, PR #30, whose base is the FE fan-in branch
`feature/t_4e1b6937`; `master` has no `apps/web`)
**Lane:** `pnpm test:a11y` (`apps/web`, `vitest.a11y.config.ts`) · also runs inside `pnpm test:unit`
**Driver:** condition from the round-1 review of FE-001k (`t_cdd23d35`), reproduced independently by QA as probe
`Q4`: a route added to the route table was graded by nobody, and both lanes stayed green.

## 1. What changed

| File | Change |
|---|---|
| `apps/web/src/a11y/routes.a11y.test.tsx` | +2 specs (route coverage vs the route table, both directions); 3 false claims corrected in place |
| `tests/evidence/t_cdd23d35/README.md` | §5 claim about route coverage corrected (it described behaviour nothing enforced) |
| `tests/evidence/t_782802ac/mutation-check.mjs` | re-runnable mutation harness (R1–R4, P1–P2) |
| `tests/evidence/t_782802ac/` | this README + the run logs below |

**No production/UI code changed.** No file under `apps/web/src/**` other than the a11y spec was touched, and the
production build is byte-identical to the parent branch:

```
apps/web  pnpm build   84 modules transformed · dist/assets/index-Dl8kBAdm.js 233.68 kB │ gzip 74.91 kB
                       → build.txt  (same module count, same asset hash as FE-001k recorded on t_cdd23d35)
```

## 2. Finding 1 — route coverage is derived from the route table, not from a hand-written list

`declaredScreenPaths(routes)` walks the exported route table (`src/routes.tsx`), nesting included, and returns the
screen paths it declares. Pathless layout routes (`A11yLayout`, `AppShell`) contribute no path of their own but
their children's paths are still collected; an index route resolves to its parent's path.

Two specs then tie the sweep to that derivation, using react-router's own `matchPath` (no second opinion about what
a route pattern means):

- **`grades every screen path the route table declares`** — every declared path must have at least one swept case
  that instantiates it (`matchPath({ path: declared, end: true }, sweptPath) !== null`). This is the assertion the
  card asks for: a route added to the table without a swept case now fails the lane.
- **`grades no path the route table does not declare`** — the converse, so a stale swept case cannot masquerade as
  coverage (a route renamed/removed, or a path that only resolves through the `*` catch-all, is not a screen).

The mapping the two specs enforce today (route table → swept case):

| Declared pattern (`src/routes.tsx`) | Swept case (`ROUTES`) | How it matches |
|---|---|---|
| `/` | `/` | exact |
| `/login` | `/login` | exact |
| `/unlock` | `/unlock` | exact |
| `/vault` | `/vault` | exact |
| `/resources/:id` | `/resources/res-123` | instance of the pattern |
| `/folders` | `/folders` | exact |
| `/tags` | `/tags` | exact |
| `/settings` | `/settings` | exact |
| `/generator` | `/generator` | exact |
| `*` | `/no/such/route` | instance of the pattern |

Ten declared paths, ten swept cases, one witness each. The swept case still asserts where the router actually lands
(`resolved`), so the two guards are graded at `/login`, not at the path that was requested.

## 3. Acceptance criteria — real execution (node v22.23.2 · pnpm 9.12.0)

| AC | Evidence | Result |
|---|---|---|
| 1. the `Q4` mutation fails `pnpm test:a11y` | `mutations.txt` R1 | **fail, exit 1** — `route coverage … > grades every screen path the route table declares`: `route table declares screen paths this sweep does not grade: /audit` |
| 2. untouched tree green | `a11y-lane.txt`, `unit-lane.txt`, `typecheck.txt`, `lint.txt`, `build.txt` | `pnpm test:a11y` **21/21**, `pnpm test:unit` **20 files / 164 tests**, `tsc -b` clean, `eslint + prettier --check` clean, build unchanged |
| 3. mismatched names/claims corrected | §4 below | 3 claims fixed, each with its measurement |
| 4. evidence committed, mutation run re-runnable | `tests/evidence/t_782802ac/mutation-check.mjs` | `node tests/evidence/t_782802ac/mutation-check.mjs` → **exit 0**, "ALL MUTATIONS BEHAVED AS EXPECTED" |

**Why the counts moved: 19 → 21 a11y tests (162 → 164 unit tests).** Two *new* specs were added; no existing case
was changed or removed. That the pre-existing 19 still pass unchanged is not a claim, it is case **R4** of the
harness: with the coverage block skipped (exactly the pre-fix lane) the lane reports `19 passed | 2 skipped (21)` —
i.e. the old sensor was green under the very mutation this card is about.

## 4. Finding 2 — the three false claims

1. **Spec name asserted the opposite of its body** (`routes.a11y.test.tsx`, was `declares no non-empty <title> in
   the source document that the app must override`, body `expect(INDEX_HTML).toMatch(/<title>\s*\S[\s\S]*?<\/title>/)`).
   Renamed to **`ships a non-empty <title> fallback in index.html that the app overrides per route`**, and the
   comment now says why the fallback must be non-empty. Body unchanged.
2. **README §5 claimed a new route "will not be silently covered"** while nothing enforced it (measured the
   opposite). The wording is replaced with what is now true and how it is enforced (derived path set vs swept set),
   and the `ROUTES` list carries a comment saying the route table — not that list — is the source of truth.
3. **`REQUIRED_PASSES` attributed "a skip link" to the list.** Axe grades `bypass` as
   `any: [internal-link-present, header-present, landmark]`, so the claim was wrong in a route-dependent way. Both
   probes are now measured facts in the harness, and the comment states them exactly:
   - **P1 — skip link removed from `A11yLayout` → fail (4 failed | 17 passed).** The six shell routes stay green
     (header + sidebar landmarks satisfy `bypass`), but `bypass` drops out of `passes` on the four pre-auth
     resolutions — `/login`, `/unlock` and the two guards that land on `/login` — where the skip link is the only
     bypass mechanism, so the vacuity guard fails there. (This refines the card's premise and QA's QA-PROBE-C,
     which holds for the shell routes only.)
   - **P2 — skip-link target id (`<main id>`) dropped → fail (11 failed | 10 passed)**, and the rule id named in
     the failures is **`region`**, not `bypass` — as the card said.
   - The skip link's own contract (exists, precedes the header, targets a focusable `<main>`) is asserted directly
     in the unit lane (`a11y.test.tsx`), where it does not depend on which axe rule happens to fire.

## 5. Mutation log — `mutations.txt`

`node tests/evidence/t_782802ac/mutation-check.mjs` — the harness drives `pnpm test:a11y` (the acceptance-criteria
command) itself, reverts every edit in a `finally` block, and records blob hashes of all four files before the run
and verifies they are identical afterwards, so a leaked edit fails the run. `--only=<ID>` runs a single case,
`--full` also dumps the raw lane output.

| # | Mutation | Expected | Observed |
|---|---|---|---|
| R1 | app: `/audit` (no `<h1>`) added to the route table, **not** to the sweep (QA probe Q4) | fail | **fail** — 1 failed \| 20 passed; coverage names `/audit` |
| R2 | lane: `/generator` case dropped from the sweep while the table still declares it | fail | **fail** — 1 failed \| 19 passed; coverage names `/generator` |
| R3 | app+lane: the same `/audit` added to the table **and** to the sweep (compliant screen) | pass | **pass** — 22 passed (coverage is a contract, not a blanket refusal of table changes) |
| R4 | control: R1 **+** the coverage block skipped (= the pre-fix lane) | pass | **pass** — 19 passed \| 2 skipped (the defect reproduces; the new specs are what turn R1 red) |
| P1 | app: skip link removed from `A11yLayout` | fail | **fail** — 4 failed \| 17 passed; `bypass` not in `passes` on `/login`, `/unlock`, `/`, `/no/such/route` |
| P2 | app: skip-link target id dropped from `<main>` | fail | **fail** — 11 failed \| 10 passed; rule id `region` |
| — | clean tree (control) | pass | **pass** — 21 passed |
| — | revert check | clean | blob hashes identical before/after |

## 6. Boundary

- This card adds a check and corrects wording. It does **not** widen what axe can evaluate under jsdom: contrast
  (WCAG 1.4.3) and target size (WCAG 2.5.8) are still disabled by name and unverified here — that is QA-002's
  browser-level card (`t_6fabf929`), unchanged by this work.
- The derivation covers the shapes this route table uses (nested children, pathless layouts, index routes,
  parameterised and splat paths). If a future table gains a route shape the walk does not understand, the specs
  fail loudly rather than silently skipping it — an unparsed path is a declared path with no witness.
- `apps/web/pnpm-lock.yaml` in the build workspace is an untracked install artefact (not committed).

## 7. Run it yourself

```bash
cd apps/web && pnpm test:a11y          # 21/21
cd apps/web && pnpm test:unit          # 20 files / 164 tests
node tests/evidence/t_782802ac/mutation-check.mjs            # exit 0, rewrites mutations.txt
node tests/evidence/t_782802ac/mutation-check.mjs --only=R1 --full   # one case, raw lane output
```
