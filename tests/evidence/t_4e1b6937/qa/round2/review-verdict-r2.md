# QA round-2 verdict — FE-001i unit tests (t_4e1b6937)

**Verdict: `pass`** (round-1 verdict was `fail`, one blocking defect D1; D1 is fixed in test code only and
re-verified here).

- Reviewed artifact: branch `feature/t_4e1b6937` @ **`823d7ab`** (`823d7abeaf0f0df51a1c49bd6ee7b738bea3ea15`) — PR **#26**
- Clone: fresh `git clone --branch feature/t_4e1b6937` (remote head re-fetched and confirmed = `823d7ab`), reviewed
  from that clone, never from the implementer's workspace.
- Toolchain (CI parity): Node **v22.23.2** · pnpm **9.12.0** via `corepack` (plus a PATH shim so nested
  `pnpm -r run <script>` delegations resolve to the pinned version) · Vitest 5.0.1 / Vite 8.3.0.
- Round: 2 (one `changes_requested` entry in the record). Lens this round: **execution** — every handoff claim below
  was re-run, not re-read.
- Reviewer: `qa`. No implementation file was edited by this reviewer; every mutation was applied in the reviewer's
  clone and reverted with `git restore` (tree clean at the end of every script, verified in the logs).

## 1. D1 — the requested correction landed and is effective

D1 (round 1): `apps/web/src/api/envelope.test.ts` → *"never echoes the bearer token into the thrown error"* could not
fail for that leak, because `vi.fn().mockResolvedValue(<one Response>)` handed an already-consumed `Response` to the
refresh call, so the assertion ran against the generic `ApiError` instead of the envelope-derived one.

Independent sensitivity matrix (`d1_r2_sensitivity.py`, run in the reviewer clone; `TOKEN` = the spec's own in-memory
access-token marker, which is what the assertion can observe):

| # | Scenario | Expected | Observed |
|---|---|---|---|
| A | **fixed** spec + M10 (marker injected into the `documentationUrl` fallback) | FAIL | **FAIL** — 2 failed / 9 passed |
| B | **pre-fix** spec (`9709272`) + M10 (same mutation) | PASS | **PASS 10/10** ⇒ the round-1 defect reproduces |
| C | fixed spec + M13 (marker appended to the envelope error `message`) | FAIL | **FAIL** — 2 failed |
| D | fixed spec + M12 (marker in the generic non-envelope branch) | FAIL | **FAIL** — 2 failed (non-envelope specs) |
| E | fixed spec + **degraded fixture** (`mockResolvedValue`, shared `Response`) | FAIL | **FAIL** — fixture guard catches it |
| F | fixed spec, no mutation | PASS | **PASS 11/11** |

Script exit 0 (all six as expected), `git status --porcelain` empty afterwards.

A's failure detail (full transcript `scenario_A_full.log`) shows the assertion is a live sensor on the exact vector
that was blind in round 1 — the error under assertion is the envelope-derived one and carries the marker:

```
× never echoes the bearer token into the thrown error
× never echoes the bearer token into a 401 error thrown without a refresh attempt
AssertionError: expected '{"kind":"http","httpStatus":401,"acti…' not to contain '<token-marker>'
Received: "{"kind":"http","httpStatus":401,"action":"TestAction","details":[{"code":"UNAUTHORIZED",…}],
           "documentationUrl":"Bearer <token-marker>","name":"ApiError"}"
Test Files  1 failed (1)   Tests  2 failed | 9 passed (11)
```

Two precision notes, both verified rather than assumed:

- Scenario E proves the *fixture guard* works: reverting only the fixture to the shared-`Response` shape makes the
  spec fail on the guard (`message === 'Unauthorized'`) instead of passing vacuously, so the round-1 failure mode
  cannot silently return.
- A marker string that is **not** the client's token (checked separately) leaves the spec green — correct semantics
  for a claim about *the bearer token*, not a defect; the sensor is the token value the client holds.
- Scenario B had to be reproduced on its own (my first matrix run corrupted the pre-fix file through my own
  `git show` helper bug — see `d1_scenario_b.py`); B's PASS is from the genuine `9709272` file.

## 2. No regression — round-1 mutation set re-run on the round-2 head

`regression_mutations.py` (same mutations I used in round 1), all 8 killed, tree clean, full suite green after revert:

| Mutation | Spec | Result |
|---|---|---|
| M1 catch-all guard `replace` removed | `routes.guards.test.tsx` | FAILED (expected) |
| M3 `header.code >= 400` branch dropped | `api/envelope.test.ts` | FAILED (expected) |
| M4 base-URL trailing-slash normalisation dropped | `api/envelope.test.ts` | FAILED (expected) |
| M5 theme toggle flattened | `stores/themeToggle.test.ts` | FAILED (expected) |
| M6 `aria-controls` always set | `layout.contract.test.tsx` | FAILED (expected) |
| M8 hardcoded hex injected | `theme.test.ts` | FAILED (expected) |
| M9 standalone colour keyword injected | `theme.test.ts` | FAILED (expected) |
| M11 theme toggle starts persisting to `localStorage` | `stores/themeToggle.test.ts` | FAILED (expected) |

`post-mutation tree clean: YES` · `full suite after revert: green (Test Files 19 passed (19) | Tests 143 passed (143))`.

## 3. Scope of the round-2 change — test code only

```
git diff --stat 9709272 823d7ab
 apps/web/src/api/envelope.test.ts           |  66 ++++++++++---
 tests/evidence/t_4e1b6937/README.md         |  72 +++++++++++++-
 tests/evidence/t_4e1b6937/d1_sensitivity.py | 142 ++++++++++++++++++++++++++++
 3 files changed, 264 insertions(+), 16 deletions(-)
```

No runtime/implementation file is touched (one spec file + two evidence files). `tests/evidence/t_4e1b6937/README.md`
and `d1_sensitivity.py` attached to the card hash-match the committed copies (see §5), so the evidence I reviewed is
the evidence on the branch.

## 4. Full suite re-run (fresh clone, CI parity)

```
corepack pnpm@9.12.0 install --frozen-lockfile   lockfile up to date (in sync)
pnpm typecheck                                   exit 0 (tsc -b clean)
pnpm lint                                        exit 0 (eslint + prettier "All matched files use Prettier code style!")
pnpm test:unit                                   Test Files 19 passed (19) · Tests 143 passed (143)
pnpm test:integration                            vitest.integration.config.ts · include src/**/*.integration.test.{ts,tsx} · 0 specs, exit 0
pnpm build                                       84 modules · dist/assets/index-Dl8kBAdm.js 233.68 kB (gzip 74.91 kB)
```

Identical to the handoff numbers, including the build hash `index-Dl8kBAdm.js` (unchanged, as expected for a test-only
diff). Unit lane still excludes `*.integration.test.*`; the integration lane still selects via the dedicated config
(the vacuous positional-filter shape stays fixed).

CI, independently checked: run **35396433249** (head `823d7ab`) = `gh pr checks 26` → **10/10 pass**
(install-lockfile, lint-typecheck, unit, integration, e2e, dependency-audit, secret-scan, sast, build + Semgrep OSS);
run **35396296260** (head `c8fa859`) = `CI` **success**. PR #26 `headRefOid` = `823d7ab`.

## 5. Hygiene / security gate

- `gitleaks detect --no-git --redact` over the reviewed tree (including the new harness): **no leaks found**.
- No `.only` / `.skip` / `.todo` in `apps/web/src`; no `console.*`, `localStorage`, `sessionStorage`, `document.cookie`
  in the changed spec or the harness.
- The token in the specs is an in-memory fixture marker; nothing is persisted or logged; SEC-001 untouched by the diff.
- Attachment fidelity: `README_1.md` sha256 `ed481c11…f29c` = `tests/evidence/t_4e1b6937/README.md`;
  `d1_sensitivity.py` sha256 `d45fabfa…c5bb` = `tests/evidence/t_4e1b6937/d1_sensitivity.py`.
- Reviewed artifact digest: `apps/web/src/api/envelope.test.ts` sha256 `e1a958de…0c18` @ `823d7ab`.

## 6. Acceptance criterion

*"Router guards, API client envelope parsing, theme toggle, layout components covered"* — satisfied on this branch:
`routes.guards.test.tsx`, `api/envelope.test.ts`, `stores/themeToggle.test.ts`,
`components/layout/layout.contract.test.tsx`, all four areas behaviour-asserted and mutation-sensitive (§1, §2).

## 7. Non-blocking notes (no change requested)

1. PR #26 is `MERGEABLE` but `mergeStateStatus=BEHIND` (master gained `94fb9de`; branch protection has
   `required_status_checks.strict=true`) — a base update is needed before merge. Correctly left out of this head so the
   re-review stayed scoped; ownership of the rebase/merge is the architect's, exactly as the implementer stated.
2. Prior-round findings carried over, unchanged and NOT waived by this verdict: no session guard
   (`t_4a892f1d`), no theme-toggle control / `data-theme` writer (`t_2162d273`), `FolderTree` drops orphan folders.
3. `routes.guards.test.tsx` pins the route table as a literal list — deliberate contract assertion; it will fail when a
   screen is added (flagged so it is not mistaken for a bug).

## 8. Repro kit (this directory)

| File | Purpose |
|---|---|
| `d1_r2_sensitivity.py` / `d1_r2_sensitivity.log` | scenarios A–F, exit 0 |
| `d1_scenario_a_detail.py` / `scenario_A_full.log` | observed failure detail for M10 on the fixed spec |
| `d1_scenario_b.py` | pre-fix spec + M10 standalone (10/10 PASS ⇒ defect reproduces) |
| `regression_mutations.py` / `regression_mutations.log` | round-1 mutation set, 8/8 killed |
| `run_suite.sh` / `suite.log` | CI-parity install/typecheck/lint/unit/integration/build |
| `collect_scope.sh` / `scope.log` | heads, diff scope, sha256, hygiene greps, gitleaks |

_No secret value is reproduced in this file: the marker is the specs' own in-memory fixture string (already in the
public repo), shown here as `<token-marker>`; the raw transcripts in this directory quote it verbatim._
