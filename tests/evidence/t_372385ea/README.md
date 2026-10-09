# QA verdicts after the fact — t_7e1cea21 (PR #117) and t_65c5a636 (PR #118)

Card: `t_372385ea` (qa). These verdicts are recorded **after** both cards were closed by
`architect` with `hermes kanban complete` while the gate reported `R1_QA_VERDICT_MISSING` and
`R4_EVIDENCE_MISSING` (see the rectification comments on both cards). They are re-checks after the
fact, not verdicts recorded at completion time.

## Provenance

- Run 1 (2026-10-09 09:31 UTC, commit `b067aeb`): read on `origin/master` @
  `a48d62227f17f438cfc3728982c5bb639721fbb1`. Not posted on the cards; the branch was pushed without a PR.
- Run 2 (2026-10-09 ~22:15 UTC, this revision): fresh `git clone` of the remote. The branch was brought up to
  date with `origin/master` @ `aab61520d3f73efe8e884a87e50f2005c344b6d5` (merge commit `79e3242`, which adds
  evidence files only). Both scripts were re-run from that clone. The two transcripts in this folder are the run-2
  output (`repo HEAD: 79e3242…`). None of the deliverable files changed between `d612272` and `aab6152`
  (`git diff --stat d612272 aab6152 -- README.md .env.example package.json .npmrc .nvmrc` is empty; only
  `ci.yml` moved, and its `NODE_VERSION: "22"` line is unchanged).

Merge commits checked against the live remote (`git merge-base --is-ancestor`, `gh pr view`, `gh run view`):

| Card | PR | Merge commit | On master | CI push run on merge commit |
|---|---|---|---|---|
| `t_7e1cea21` TOOL-001 | #117 (MERGED 2026-10-08T16:38:07Z) | `b19fe2769f018ededec362153a710e16c7d3e1f4` | yes | run 37810337731, `success` |
| `t_65c5a636` README | #118 (MERGED 2026-10-08T17:28:56Z) | `d612272176befe84b7646a0484ab88cbacdec173` | yes | run 37816898767, `success` |

## t_7e1cea21 — verdict: pass

| AC | Check on master | Result |
|---|---|---|
| 1 `.nvmrc` + `engines.node` tightened, consistent with CI | `.nvmrc` = `22`; root `package.json` `engines.node` = `>=22 <23`; `.github/workflows/ci.yml` line 50 `NODE_VERSION: "22"`, used by every `setup-node` step | met |
| 2 README "Node.js >= 20" corrected | README states Node.js 22, points to `.nvmrc`, says Node 23–25 untested (Prerequisites, lines 62–67) | met |
| 3 a wrong Node gives a clear signal at install | replayed, see below | met |
| ci: the bound includes CI's own version | CI push run on `b19fe27` is `success`; case C below installs on Node 22 | met |

Replay (`replay-engine-strict.sh`, transcript `replay-engine-strict.transcript.txt`). Each case runs in a throw-away
`git worktree`, `pnpm install --frozen-lockfile`, pnpm 9.12.0. Node 22.23.3 is the official tarball
(`SHASUMS256.txt` checked):

- A — Node v26.7.0, `.npmrc` present: **exit 1**, `ERR_PNPM_UNSUPPORTED_ENGINE`, `Expected version: >=22 <23`, `Got: v26.7.0`.
- B — Node v26.7.0, `.npmrc` removed: exit 0, only `WARN Unsupported engine`. So `engine-strict=true` is load-bearing.
- C — Node v22.23.3, `.npmrc` present: exit 0.

Not replayed: the Node 26 failure counts (52/350 unit, 13/43 integration) quoted on the card. They justify the upper
bound but are not an acceptance criterion.

## t_65c5a636 — verdict: fail

What holds. The sentence the card asked QA to check is present and true: README lines 11–12, "**Client-side
end-to-end encryption is not yet wired** — awaiting Option B design approval (t_3f1b0521)". On master,
`apps/web/src` has no `crypto.subtle`, no `@password-manager/crypto` import and no argon2. The Implemented labels
(Web UI, API) and Planned labels (Firefox MV3, sync) are present. Prerequisites list Node 22, pnpm, Git, Firefox,
Docker-not-required and platform notes. `.env.example` holds synthetic values only. No Mermaid diagram, and
`docs/development/setup.md` was not authored.

Blocking defects. Both were introduced by PR #118 in the `.env.example` walkthrough that the card's acceptance
criteria require. No card tracks them today.

1. **`.env.example` value crashes the API.** `DATABASE_URL=file:./dev.db` (`.env.example` line 18 and the README
   `.env.local` snippet) is passed verbatim to `new Database(url)` in `apps/services/api/src/db.ts:21-23`
   (better-sqlite3 9.6.0, which does not parse `file:` URIs). Running the real entry point
   `apps/services/api/src/index.ts` with that value gives
   `TypeError: Cannot open database because the directory does not exist`. With `DATABASE_URL` unset, the same entry
   point starts (`listening at http://127.0.0.1:39118`). The value must be a plain path (`./dev.db`, the code
   default). Probe P2/P2b/P2c.
2. **Quick start step 3 is inert.** `cp .env.example .env.local` has no effect on the API. Nothing in
   `apps/services/api` or in the package scripts loads an env file: no dotenv, no `--env-file`, no `loadEnvFile`.
   The dev script is `tsx watch src/index.ts`. The README presents the step, and the `.env.local` section, as
   configuring the local environment. Probe P1.

Non-blocking for this card:

3. **README lines 29–30** ("uses symmetric AEAD with a client-derived vault key" / "the server never sees the master
   password") are false today: `apps/services/api/src/auth/register.ts` (lines 53, 111, 133) and `unlock.ts`
   (lines 87, 150, 218) take `masterPassword` from the request body and run the KDF server-side. The web pages
   `LoginPage.tsx:99` and `UnlockPage.tsx:99` send it. Probe P3. The two lines **predate** PR #118, which only added
   a final period to each (`git show d612272 -- README.md`). Architect routed the line-30 fix to `t_00457c72`, in
   the same PR as the SECURITY.md correction. Run 1 classified this as blocking. Run 2 downgrades it because the
   defect is not attributable to #118 and already has an owner. **Line 29 must be included in that fix**: it makes
   the same false claim.
4. **Minor — duplicated Node paragraph.** The Node 22 / `ERR_PNPM_UNSUPPORTED_ENGINE` text appears twice
   (Prerequisites lines 62–67 and Quick start lines 84–86), a rebase leftover. Probe P4.
5. **Minor — dangling reference.** Line 75 says Docker Compose for PostgreSQL "is documented in the full setup
   guide". `docs/development/setup.md` does not exist on master (owned by `t_f443682a`). It should say "will be".
   Probe P5.

Scope to rework (owner `docs`, correction card to be created by `architect`): `DATABASE_URL` in `.env.example` and in
the README snippet (plain path); Quick start step 3 and the `.env.local` section (either document that the variables
must be exported in the shell, or remove the step; wiring env-file loading would be a code change outside a docs
card); the duplicated Node paragraph; the setup-guide tense on line 75. README lines 29–30 belong to `t_00457c72`.

## Gate state

`signoff-gate.mjs check --task <id> --repo <clone>` before and after the verdict comments:
`gate-check-before.txt` and `gate-check-after.txt`. A `done` card that carries a `fail` verdict is reported by the
gate as a violation (`TERMINAL_BAD_VERDICTS` in `scripts/qa/signoff-gate.mjs`). That is correct behaviour, not a gate
defect: `t_65c5a636` cannot show 0 violations while its deliverable fails. `t_372385ea`'s acceptance criterion
"0 violations for each" therefore holds for `t_7e1cea21` only. For `t_65c5a636`, the violation clears when the
correction lands and qa records a new verdict.

## Reproduce

```bash
git clone https://github.com/zeldadil/password-manager.git && cd password-manager
NODE22_BIN=<node22>/bin NODE26_BIN=<node26>/bin bash tests/evidence/t_372385ea/replay-engine-strict.sh
NODE22_BIN=<node22>/bin bash tests/evidence/t_372385ea/probe-readme-claims.sh
```

The probe runs `pnpm install` in the clone and writes its SQLite probe files under `$TMPDIR`. It leaves no tracked
file modified. Its final `ls` exits 2 by design (P5: the file is absent).
