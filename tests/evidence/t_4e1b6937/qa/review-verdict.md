# FE-001i (t_4e1b6937) — QA review, round 1

**Reviewer:** `qa` · **Lens for round 1:** artifact (cold read) + execution (independently reproduced)
**Under review:** `feature/t_4e1b6937` @ `9709272` · PR #26 · CI run 35395054902
**Verdict:** **request changes** — one new spec contains an assertion that cannot fail for the leak it
names (`QA-VERDICT: fail` recorded on the card with this report as evidence).

Everything else in the deliverable verified green and is NOT in question; the required fix is confined
to test code in `apps/web/src/api/envelope.test.ts` (see D1).

---

## 1. Independently reproduced (fresh clone of the pushed branch, not the worker's workspace)

```
git clone --branch feature/t_4e1b6937 https://github.com/zeldadil/password-manager.git
HEAD = 970927292276341ea70e4d2ddf008054b4614962   (== PR #26 head, == CI head)
corepack pnpm@9.12.0 install --frozen-lockfile     lockfile in sync (2 workspace projects)
pnpm typecheck                                     tsc -b Done
pnpm lint                                          eslint 0 problems · prettier "All matched files use Prettier code style!"
pnpm test:unit                                     Test Files 19 passed (19) · Tests 142 passed (142)
pnpm test:integration                              include src/**/*.integration.test.{ts,tsx} · no specs yet (FE-001j) exit 0
pnpm build                                         84 modules · dist/assets/index-Dl8kBAdm.js 233.68 kB (gzip 74.91 kB)
gh pr checks 26                                    10 checks: 9 CI jobs (install-lockfile, lint-typecheck, unit,
                                                   integration, e2e, dependency-audit, secret-scan, sast, build)
                                                   + Semgrep OSS — all pass
```

Runtime: Node v22.23.2, pnpm 9.12.0 via corepack (shim on PATH for nested `pnpm -r run` delegations, as
`pnpm/action-setup` does in CI). Byte-for-byte agreement with the handoff (142 tests, 233.68 kB / 74.91 kB
gzip) and with the worker's addendum.

## 2. The integration is faithful — no unreviewed semantic drift in the approved parents

`c4165fd` ("integrate FE-001f/g sources onto the FE-001b/c/d/e UI stack") rewrites ~1.2k lines of parent
code, so I canonicalised **each parent version with the repo's own prettier** and diffed against HEAD:

| File | vs parent | Result |
|---|---|---|
| `api/client.ts`, `api/errors.ts`, `api/tokenStore.ts`, `api/types.ts`, `api/index.ts` | FE-001g `t_d19ced15` | **pure prettier reflow — identical** |
| `stores/themeStore.ts`, `stores/uiStore.ts`, `stores/index.ts`, `queryClient.ts` | FE-001g | **pure prettier reflow — identical** |
| `components/layout/Header.tsx` | FE-001e `t_7d365ce0` | **pure prettier reflow — identical** |
| `index.css` | FE-001d / FE-001e | union: FE-001d `:root` (tokens moved to `theme.css`) + FE-001e a11y baseline |
| `main.tsx` | FE-001g | + `import './theme.css'` (FE-001d wiring) — expected |

So the code under test is the code that was already reviewed and approved, and the two documented test
repairs are the only behaviour-adjacent edits.

## 3. The two test repairs are sound (checked, not taken on trust)

1. `theme.test.ts` hardcoded-colour detector was relaxed (`\b` → `(?![\\w-])`). A relaxed *detector* is
   exactly the kind of change that can gut a check, so it was mutation-tested in both directions:
   - `index.css` + `.bad-hex { color: #ff0000; }` → **FAIL** (expected) ✔
   - `index.css` + `.bad-keyword { color: red; }` → **FAIL** (expected) ✔
   - the a11y baseline's `white-space: nowrap` no longer false-positives (suite green with it present) ✔
2. `App.test.tsx` rewritten to the real entry behaviour — `App` → router → `/login`; replacing `App` with a
   scaffold heading **fails** it ✔

## 4. The lane-split fix is real (independently reproduced with my own probe spec)

| Probe | Result |
|---|---|
| New script `pnpm test:integration` (`vitest.integration.config.ts`), probe spec present | **1 file / 1 test ran** ✔ |
| Old script shape (`vitest run --passWithNoTests 'src/**/*.integration.test.{ts,tsx}'`), probe present | `No test files found, exiting with code 0` — **vacuous green confirmed** ✔ |
| `pnpm test:unit` with probe present | 19 files / 142 tests — probe excluded ✔ |

The worker's claim ("a green integration check that ran nothing") reproduces exactly; the fix is
necessary, not cosmetic.

## 5. Mutation checks — 9/9 killed (my own, on the pushed tree)

Each mutation breaks one behaviour a new spec claims to pin; the spec must then fail. All reverted;
tree verified clean afterwards; full suite green again.

| # | Mutation | Spec | Result |
|---|---|---|---|
| M1 | catch-all `Navigate` loses `replace` | `routes.guards.test.tsx` | FAILED as expected ✔ |
| M2 | catch-all renders a screen instead of redirecting | `routes.guards.test.tsx` | FAILED as expected ✔ |
| M3 | `header.code >= 400` branch dropped | `api/envelope.test.ts` | FAILED as expected ✔ |
| M4 | base-URL trailing-slash normalisation dropped | `api/envelope.test.ts` | FAILED as expected ✔ |
| M5 | `toggleTheme` flattened to always `light` | `stores/themeToggle.test.ts` | FAILED as expected ✔ |
| M6 | `aria-controls` always set while collapsed | `layout.contract.test.tsx` | FAILED as expected ✔ |
| M7 | `App` renders a scaffold heading instead of the router | `App.test.tsx` | FAILED as expected ✔ |
| M8 | hardcoded hex into `index.css` | `theme.test.ts` | FAILED as expected ✔ |
| M9 | standalone colour keyword into `index.css` | `theme.test.ts` | FAILED as expected ✔ |
| M11 | theme toggle starts persisting to `localStorage` | `stores/themeToggle.test.ts` | FAILED as expected ✔ (SEC-001 sensor is live) |

## 6. D1 — BLOCKING defect: the secret-hygiene test cannot fail for the leak it names

**Where:** `apps/web/src/api/envelope.test.ts`, `describe('ApiClient — secret hygiene in errors')`
(head 9709272, lines 173–195).

**Symptom:** mutation M10 — inject the bearer token into the *envelope-derived* error's enumerable fields
(`errors.ts`: `documentationUrl: body?.documentationUrl ?? 'Bearer super-secret-jwt'`) — the spec stays
**10/10 green**. A leak of the live bearer token into a thrown error is exactly what this test claims to
catch ("never echoes the bearer token into the thrown error").

**Mechanism (proved, not inferred).** The test mocks with `vi.fn().mockResolvedValue(<one Response>)`:

* `client.get('/resources')` → 401 → `isUnauthorized` → `refresh()` → second fetch **re-reads the same
  `Response` object**, whose body the first read already consumed;
* `tryReadJson()` (`client.ts:271-277`) swallows the resulting `TypeError` and returns `null`;
* so `parseErrorResponse` takes the **non-envelope** branch and throws the generic
  `new ApiError({ message: 'Request failed with status 401', ... })`.

Measured error object in the test's own scenario (probe `probeSecretHygiene.test.ts`, dumped to JSON):

| mock shape | message | details | stringified |
|---|---|---|---|
| `mockResolvedValue` (what the spec does) | `Request failed with status 401` | `[]` | `{"kind":"http","httpStatus":401,"action":null,"details":[],"name":"ApiError"}` |
| fresh `Response` per call (realistic server) | `Unauthorized` (envelope header) | populated | includes `action`, `details`, `documentationUrl` |

The envelope-error path — the one that carries server text, `details`, `action` and `documentationUrl`
into the error — is therefore **never the object under assertion**. `not.toContain('super-secret-jwt')`
on `message` and on `JSON.stringify(error)` is trivially true of a hardcoded generic message.
(For precision: the assertion *is* live for a leak in the generic path — M12 injecting the token into that
branch fails the spec — but that is not the vector the fixture sets up.)

**Minimum fix (test code only):** return a fresh `Response` per fetch call — e.g.
`vi.fn().mockImplementation(() => Promise.resolve(envelope401()))` (or two `mockResolvedValueOnce`
envelopes) — so the thrown error really is the envelope-derived one, then re-run the mutation above and
record it in `tests/evidence/t_4e1b6937/README.md` (that file's mutation table lists 4 mutations; this
test was the one without a sensitivity check). A one-line comment on the shared-`Response` pitfall would
keep the next author from re-introducing it.

## 7. Non-blocking observations (no change requested)

1. `routes.guards.test.tsx` asserts the route table's owned paths as a literal list (`shellPaths`
   `toEqual([...])`). It is a deliberate contract assertion, but it will fail on any added screen. Fine as
   a deliberate change-detector; flagging so it is not mistaken for a bug later.
2. `stores/themeToggle.test.ts` reads `theme.css` as text. It verifies the *store ↔ stylesheet* contract,
   not runtime application — and the worker says so in the file header. Acceptable; the missing
   `data-theme` writer is already reported as a finding.
3. The worker's findings 1–3 (no session guard; no theme-toggle control; `FolderTree` drops orphan
   folders) are **correct and honestly reported**, are outside this card's AC, and are not being waived
   by this review — see the follow-up cards created for the architect decisions.

## 8. Hygiene

- No secret-shaped strings in the branch diff, the new specs or the evidence file (grep for `ghp_`,
  `github_pat_`, `xox[bpa]-`, `sk-…`, `AKIA…`, `-----BEGIN`, `eyJ…`): none.
- No `.only` / `.skip` / `.todo` anywhere in `apps/web/src`; no `console.*`, `localStorage` or network use
  in the new specs other than the negative SEC-001 assertions.
- The token values in the specs (`super-secret-jwt`) are marker strings, not credentials.
- Reviewer made no edit to any implementation file: all probes/mutations ran in a throwaway clone and
  every mutation was reverted (`git status --porcelain` empty after each round).
