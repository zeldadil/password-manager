# gitleaks full-history baseline (t_76461419)

Status: in force since the PR of `t_76461419` (2026-10-10). Owner: `qa`.

## Why a baseline

On `workflow_dispatch` and `schedule`, the `gitleaks` step scans **every ref**
(`git log -p -U0 --full-history --all`). Before this baseline that scan reported
224 findings on every run (rule `generic-api-key` on test fixtures and code, plus
11 `telegram-token` detections from the September 2026 incident) and was red
permanently — so nobody read it, and a real new leak in the history would have
gone unnoticed.

The baseline is `.gitleaksignore`, **one commit-scoped fingerprint per line**:

    <commit sha>:<file>:<rule id>:<line>

* No file-wide, rule-wide or commit-less (`file:rule:line`) exclusion: a new
  finding in a file that already has baselined findings has a different commit
  and/or line, so it is still reported. `scripts/qa/check-gitleaksignore.sh`
  enforces the format in both `ci.yml` (`secret-scan`) and
  `secret-scan-full-history.yml`.
* No `--baseline-path`: a gitleaks JSON report used as a baseline carries the
  `Secret` and `Match` fields, i.e. the values themselves. The repository is
  public, so it would republish them. This file and `.gitleaksignore` contain
  fingerprints only, never a value.
* History is **not** rewritten to "clean" findings (forbidden without explicit
  human approval). The baseline exists precisely so that it is not needed.

## Scope and tooling

* Scanner: gitleaks **8.24.3** (pinned through `GITLEAKS_VERSION` in both
  workflows; it is also the gitleaks-action v2 default). The fingerprints were
  generated with 8.24.3 and cross-checked with 8.30.1: same result (0 findings
  with the baseline). A version bump must be re-checked against the baseline.
* Rules: the repository's own `.gitleaks.toml` (unchanged by this card).
* Refs: all branches and tags of `origin` on 2026-10-10 (51 branches, 297
  commits scanned).

## Content of `.gitleaksignore`

| part | entries | what |
|---|---|---|
| pre-existing entries still matching | 118 | added by earlier cards (PR #16, #45, #46, #54, #58, #60, #88, #106); justified by the comments above them in the file |
| pre-existing entries matching nothing | 141 | commits `2147c91…`, `c0b4e45…`, `19b7798…`, `091f35d…`, `31b49b8…`, `a87abc2…`, `4ca58c7…` are no longer reachable from any ref (deleted branches). Kept on purpose: a fingerprint names an exact commit, so if one of those commits is ever re-pushed its content is byte-identical to what was already justified, and re-flagging it would be a false alarm. They cannot match anything else. |
| **added by t_76461419** | **224** | groups G1–G6 below, appended at the end of the file without comment lines (the PR diff of `.gitleaksignore` contains fingerprint lines only) |

## Groups added by t_76461419

How each finding was classified, without reading a value into any file: a
script printed, per finding, the key name, a *masked shape* of the value
(`a`/`A`/`9` per character class) and the source line with the match replaced
by a placeholder. A value was printed in clear only when it was a dotted code
expression (`tokens.accessToken`, `process.env.JWT_SECRET`).

* **G1 — test fixtures.** Synthetic master passwords made of dictionary words +
  digits (`master<Password>: '<word>-<word>-<word>-<digits>'`), per-test JWT
  signing secrets (`TEST_SECRET`), calls to token generators
  (`const token = generate…()`), and the inputs of the `redactSecrets` unit
  tests in `security.test.ts` (two JWT-shaped bearer strings with a repetitive
  `abc123…` signature, keyword/value pairs). None is a credential of any system.
* **G2 — code, not values.** `process.env.JWT_SECRET` lookups, property
  accesses (`tokens.refreshToken`, `this.tokenStore.getAccessToken`), and calls
  (`generateRefreshToken()`, `normalizeVerdictToken(...)` in `signoff-gate.mjs`). The
  custom `generic-api-key` regex matches `token: <16+ word chars>` and cannot
  tell an identifier from a literal.
* **G3 — documentation placeholders.** `ADR-002` (example `password:` field in a
  message table) and `docs/development/setup.md` (a `JWT_SECRET=` placeholder
  telling the reader to replace it).
* **G4 — QA evidence.** Snapshots of `signoff-gate.mjs` kept as evidence
  (`tests/evidence/t_7dd3b960`, `t_338f47fd/gate-fix.diff`), the verdict-token
  inventory of `t_338f47fd` (its `token` column holds a verdict word such as `pass` or `changes`), and probe tests /
  scripts of `t_4e1b6937` that reuse the G1 fixture token.
* **G5 — secret-guard test vectors.** A synthetic `AKIA…` access-key-id used by
  `scripts/qa/secret-guard.selftest.mjs` and its live-fire evidence
  (`tests/evidence/t_b51a1ff3/live-fire.txt`) to prove the comment hook blocks
  AWS keys. An access-key id alone is not a credential, and no
  `aws-secret-access-key` finding exists anywhere in the history.
* **G6 — `telegram-token`: 11 detections, 4 distinct values, all revoked.**
  Citing `t_0af5aa3e` was not enough (architect, 2026-10-09): the history could
  hold several values. Check performed on 2026-10-10 by
  `tg_revocation_check.py` (kept in the evidence directory of the card): every
  distinct value is read from the scan **in memory only**, `getMe` is called
  once per value, and only the gitleaks fingerprint, the first 16 hex of
  `sha256(value)` and the HTTP status are printed. Result: **4/4 values answer
  HTTP 401 (`ok=false`)** — no live token, so these are baseline entries, not
  an incident. Two values are the incident tokens already tracked on the board
  (sha256 prefixes match the evidence of `t_e348e0b7` and `t_d20787de`).

### G1 — Test fixtures (synthetic credentials and token-generator calls in test code) (146 fingerprints)

| rule | file | fingerprints |
|---|---|---|
| `bearer-token` | `apps/services/api/tests/auth/security.test.ts` | 2 |
| `generic-api-key` | `apps/services/api/tests/auth/fullflow.integration.test.ts` | 27 |
| `generic-api-key` | `apps/services/api/tests/auth/jwt.test.ts` | 3 |
| `generic-api-key` | `apps/services/api/tests/auth/lock-v2.test.ts` | 5 |
| `generic-api-key` | `apps/services/api/tests/auth/lock.test.ts` | 8 |
| `generic-api-key` | `apps/services/api/tests/auth/refresh-unit.test.ts` | 10 |
| `generic-api-key` | `apps/services/api/tests/auth/refresh.test.ts` | 6 |
| `generic-api-key` | `apps/services/api/tests/auth/register.test.ts` | 5 |
| `generic-api-key` | `apps/services/api/tests/auth/security.test.ts` | 12 |
| `generic-api-key` | `apps/services/api/tests/auth/unlock.test.ts` | 36 |
| `generic-api-key` | `apps/services/api/tests/auth/wrong-password.test.ts` | 17 |
| `generic-api-key` | `apps/web/src/api/envelope.test.ts` | 2 |
| `generic-api-key` | `packages/crypto/tests/vault.test.ts` | 2 |
| `generic-api-key` | `tests/fixtures/README.md` | 1 |
| `generic-api-key` | `tests/fixtures/user.ts` | 2 |
| `generic-api-key` | `tests/integration/web/auth-flow.integration.test.tsx` | 2 |
| `generic-api-key` | `tests/integration/web/rate-limit.integration.test.tsx` | 4 |
| `generic-api-key` | `tests/integration/web/token-refresh.integration.test.ts` | 2 |

<details><summary>fingerprints</summary>

```
09b91f34befd5f39554164699bc637b724604f03:tests/integration/web/auth-flow.integration.test.tsx:generic-api-key:73
09b91f34befd5f39554164699bc637b724604f03:tests/integration/web/rate-limit.integration.test.tsx:generic-api-key:65
09b91f34befd5f39554164699bc637b724604f03:tests/integration/web/rate-limit.integration.test.tsx:generic-api-key:66
09b91f34befd5f39554164699bc637b724604f03:tests/integration/web/token-refresh.integration.test.ts:generic-api-key:32
0f4031d3687d6c04c6b01e3d4ab33de00eb88ef1:tests/fixtures/README.md:generic-api-key:48
0f4031d3687d6c04c6b01e3d4ab33de00eb88ef1:tests/fixtures/user.ts:generic-api-key:70
0f4031d3687d6c04c6b01e3d4ab33de00eb88ef1:tests/fixtures/user.ts:generic-api-key:71
126c2dbc336af6fcf66e70e47f2448e76e642427:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:13
126c2dbc336af6fcf66e70e47f2448e76e642427:apps/services/api/tests/auth/refresh.test.ts:generic-api-key:179
126c2dbc336af6fcf66e70e47f2448e76e642427:apps/services/api/tests/auth/refresh.test.ts:generic-api-key:221
126c2dbc336af6fcf66e70e47f2448e76e642427:apps/services/api/tests/auth/refresh.test.ts:generic-api-key:270
126c2dbc336af6fcf66e70e47f2448e76e642427:apps/services/api/tests/auth/refresh.test.ts:generic-api-key:310
126c2dbc336af6fcf66e70e47f2448e76e642427:apps/services/api/tests/auth/refresh.test.ts:generic-api-key:58
126c2dbc336af6fcf66e70e47f2448e76e642427:apps/services/api/tests/auth/refresh.test.ts:generic-api-key:72
17fd35abb81730f4feacf16c43a5a3f29d803e91:apps/services/api/tests/auth/register.test.ts:generic-api-key:158
17fd35abb81730f4feacf16c43a5a3f29d803e91:apps/services/api/tests/auth/register.test.ts:generic-api-key:187
17fd35abb81730f4feacf16c43a5a3f29d803e91:apps/services/api/tests/auth/register.test.ts:generic-api-key:215
17fd35abb81730f4feacf16c43a5a3f29d803e91:apps/services/api/tests/auth/register.test.ts:generic-api-key:63
17fd35abb81730f4feacf16c43a5a3f29d803e91:apps/services/api/tests/auth/register.test.ts:generic-api-key:89
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/jwt.test.ts:generic-api-key:15
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/jwt.test.ts:generic-api-key:82
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/jwt.test.ts:generic-api-key:93
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock-v2.test.ts:generic-api-key:118
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock-v2.test.ts:generic-api-key:167
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock-v2.test.ts:generic-api-key:193
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock-v2.test.ts:generic-api-key:48
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock-v2.test.ts:generic-api-key:69
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock.test.ts:generic-api-key:115
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock.test.ts:generic-api-key:121
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock.test.ts:generic-api-key:141
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock.test.ts:generic-api-key:201
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock.test.ts:generic-api-key:249
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock.test.ts:generic-api-key:42
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock.test.ts:generic-api-key:58
2c218382436ce43c2b2e90ca14804ca8efc3f287:apps/services/api/tests/auth/lock.test.ts:generic-api-key:65
314960e72682f4a08223b990ee96daddbac8bd3b:packages/crypto/tests/vault.test.ts:generic-api-key:185
314960e72682f4a08223b990ee96daddbac8bd3b:packages/crypto/tests/vault.test.ts:generic-api-key:23
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:110
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:135
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:153
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:170
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:185
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:200
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:246
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:262
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:290
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:299
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:61
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:90
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:122
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:146
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:178
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:194
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:222
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:239
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:253
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:271
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:290
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:306
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:330
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:359
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:375
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:407
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:431
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:459
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:501
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:514
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:578
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:602
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:668
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:678
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:71
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:741
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:769
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:786
3b00eeb2df09defda24289240af12738ac37e801:apps/services/api/tests/auth/fullflow.integration.test.ts:generic-api-key:99
62c5a4f6613888a6ea68a1bb018a91742af30e61:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:105
62c5a4f6613888a6ea68a1bb018a91742af30e61:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:177
62c5a4f6613888a6ea68a1bb018a91742af30e61:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:178
62c5a4f6613888a6ea68a1bb018a91742af30e61:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:184
62c5a4f6613888a6ea68a1bb018a91742af30e61:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:185
62c5a4f6613888a6ea68a1bb018a91742af30e61:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:49
62c5a4f6613888a6ea68a1bb018a91742af30e61:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:74
62c5a4f6613888a6ea68a1bb018a91742af30e61:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:86
62c5a4f6613888a6ea68a1bb018a91742af30e61:apps/services/api/tests/auth/refresh-unit.test.ts:generic-api-key:94
8ecf9a18459d061ac5d202e3c5f9b26861b9e5e4:tests/integration/web/auth-flow.integration.test.tsx:generic-api-key:71
8ecf9a18459d061ac5d202e3c5f9b26861b9e5e4:tests/integration/web/rate-limit.integration.test.tsx:generic-api-key:63
8ecf9a18459d061ac5d202e3c5f9b26861b9e5e4:tests/integration/web/rate-limit.integration.test.tsx:generic-api-key:64
8ecf9a18459d061ac5d202e3c5f9b26861b9e5e4:tests/integration/web/token-refresh.integration.test.ts:generic-api-key:32
a4746466c7593fbfd7e428523b13657487109795:apps/web/src/api/envelope.test.ts:generic-api-key:191
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:bearer-token:523
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:bearer-token:568
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:113
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:122
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:133
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:455
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:499
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:531
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:532
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:533
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:534
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:541
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:542
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:generic-api-key:553
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:110
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:135
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:153
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:176
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:192
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:210
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:258
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:277
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:305
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:314
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:61
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:90
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:102
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:167
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:185
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:202
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:235
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:257
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:302
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:319
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:330
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:357
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:431
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:459
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:471
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:504
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:515
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:62
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/tests/auth/wrong-password.test.ts:generic-api-key:92
c4165fd79b8125a0a43e6240fcf165c0c73d5f25:apps/web/src/api/envelope.test.ts:generic-api-key:176
d2aa9aa7aed075490e9835484cff21d5539c12c1:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:130
d2aa9aa7aed075490e9835484cff21d5539c12c1:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:139
d2aa9aa7aed075490e9835484cff21d5539c12c1:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:172
d2aa9aa7aed075490e9835484cff21d5539c12c1:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:261
d2aa9aa7aed075490e9835484cff21d5539c12c1:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:304
d2aa9aa7aed075490e9835484cff21d5539c12c1:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:85
d5eeacb76ad84455bdd984f7aaacc98ff83ecc9e:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:130
d5eeacb76ad84455bdd984f7aaacc98ff83ecc9e:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:139
d5eeacb76ad84455bdd984f7aaacc98ff83ecc9e:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:172
d5eeacb76ad84455bdd984f7aaacc98ff83ecc9e:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:261
d5eeacb76ad84455bdd984f7aaacc98ff83ecc9e:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:304
d5eeacb76ad84455bdd984f7aaacc98ff83ecc9e:apps/services/api/tests/auth/unlock.test.ts:generic-api-key:85
```

</details>

### G2 — Source code expressions, no literal value (env lookups, property accesses, function calls) (33 fingerprints)

| rule | file | fingerprints |
|---|---|---|
| `generic-api-key` | `apps/services/api/src/auth/jwt.ts` | 1 |
| `generic-api-key` | `apps/services/api/src/auth/refresh.ts` | 2 |
| `generic-api-key` | `apps/services/api/src/auth/unlock.ts` | 10 |
| `generic-api-key` | `apps/web/src/api/client.ts` | 6 |
| `generic-api-key` | `apps/web/src/api/tokenStore.ts` | 9 |
| `generic-api-key` | `scripts/qa/signoff-gate.mjs` | 5 |

<details><summary>fingerprints</summary>

```
0f750820fb5422cf1682ce3f2598f797c84a8b6e:apps/web/src/api/client.ts:generic-api-key:126
0f750820fb5422cf1682ce3f2598f797c84a8b6e:apps/web/src/api/client.ts:generic-api-key:182
0f750820fb5422cf1682ce3f2598f797c84a8b6e:apps/web/src/api/tokenStore.ts:generic-api-key:23
0f750820fb5422cf1682ce3f2598f797c84a8b6e:apps/web/src/api/tokenStore.ts:generic-api-key:48
0f750820fb5422cf1682ce3f2598f797c84a8b6e:apps/web/src/api/tokenStore.ts:generic-api-key:49
126c2dbc336af6fcf66e70e47f2448e76e642427:apps/services/api/src/auth/refresh.ts:generic-api-key:174
126c2dbc336af6fcf66e70e47f2448e76e642427:apps/services/api/src/auth/refresh.ts:generic-api-key:210
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/src/auth/unlock.ts:generic-api-key:172
348422860761f74a3aee48c2066ad4b86a0d5144:apps/services/api/src/auth/unlock.ts:generic-api-key:22
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/src/auth/jwt.ts:generic-api-key:113
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/src/auth/unlock.ts:generic-api-key:261
c30d7bf925072724d53ac9b1c81a6d32ddbcacf3:apps/services/api/src/auth/unlock.ts:generic-api-key:30
c4165fd79b8125a0a43e6240fcf165c0c73d5f25:apps/web/src/api/client.ts:generic-api-key:126
c4165fd79b8125a0a43e6240fcf165c0c73d5f25:apps/web/src/api/client.ts:generic-api-key:182
c4165fd79b8125a0a43e6240fcf165c0c73d5f25:apps/web/src/api/tokenStore.ts:generic-api-key:23
c4165fd79b8125a0a43e6240fcf165c0c73d5f25:apps/web/src/api/tokenStore.ts:generic-api-key:48
c4165fd79b8125a0a43e6240fcf165c0c73d5f25:apps/web/src/api/tokenStore.ts:generic-api-key:49
c54e3e0026b4640041b32b10f216c3ca451e2a2b:apps/web/src/api/client.ts:generic-api-key:126
c54e3e0026b4640041b32b10f216c3ca451e2a2b:apps/web/src/api/client.ts:generic-api-key:182
c54e3e0026b4640041b32b10f216c3ca451e2a2b:apps/web/src/api/tokenStore.ts:generic-api-key:23
c54e3e0026b4640041b32b10f216c3ca451e2a2b:apps/web/src/api/tokenStore.ts:generic-api-key:48
c54e3e0026b4640041b32b10f216c3ca451e2a2b:apps/web/src/api/tokenStore.ts:generic-api-key:49
d2aa9aa7aed075490e9835484cff21d5539c12c1:apps/services/api/src/auth/unlock.ts:generic-api-key:151
d2aa9aa7aed075490e9835484cff21d5539c12c1:apps/services/api/src/auth/unlock.ts:generic-api-key:174
d2aa9aa7aed075490e9835484cff21d5539c12c1:apps/services/api/src/auth/unlock.ts:generic-api-key:175
d5eeacb76ad84455bdd984f7aaacc98ff83ecc9e:apps/services/api/src/auth/unlock.ts:generic-api-key:151
d5eeacb76ad84455bdd984f7aaacc98ff83ecc9e:apps/services/api/src/auth/unlock.ts:generic-api-key:174
d5eeacb76ad84455bdd984f7aaacc98ff83ecc9e:apps/services/api/src/auth/unlock.ts:generic-api-key:175
e23ca8a09e555c9b865318029dae2bba4bfff335:scripts/qa/signoff-gate.mjs:generic-api-key:392
e23ca8a09e555c9b865318029dae2bba4bfff335:scripts/qa/signoff-gate.mjs:generic-api-key:397
f74fb094edc6d02807cd8c7ad6b9fd1d5c8f2e7f:scripts/qa/signoff-gate.mjs:generic-api-key:199
f74fb094edc6d02807cd8c7ad6b9fd1d5c8f2e7f:scripts/qa/signoff-gate.mjs:generic-api-key:212
f74fb094edc6d02807cd8c7ad6b9fd1d5c8f2e7f:scripts/qa/signoff-gate.mjs:generic-api-key:228
```

</details>

### G3 — Documentation placeholders (2 fingerprints)

| rule | file | fingerprints |
|---|---|---|
| `generic-api-key` | `architecture/adr/ADR-002-overall-architecture.md` | 1 |
| `generic-api-key` | `docs/development/setup.md` | 1 |

<details><summary>fingerprints</summary>

```
4bfc7ccac8bfa7ec1939a97af090d617f8f3f5a7:docs/development/setup.md:generic-api-key:277
ad01bb48e3a83d84e77f469b96465476b40a9ab8:architecture/adr/ADR-002-overall-architecture.md:generic-api-key:409
```

</details>

### G4 — QA evidence files (snapshots of gate code, verdict-token inventories, probe tests) (24 fingerprints)

| rule | file | fingerprints |
|---|---|---|
| `generic-api-key` | `tests/evidence/t_338f47fd/gate-fix.diff` | 2 |
| `generic-api-key` | `tests/evidence/t_338f47fd/non-qa-marker-inventory.txt` | 9 |
| `generic-api-key` | `tests/evidence/t_4e1b6937/d1_sensitivity.py` | 2 |
| `generic-api-key` | `tests/evidence/t_4e1b6937/qa/probeErrorShape.test.ts` | 1 |
| `generic-api-key` | `tests/evidence/t_4e1b6937/qa/probeSecretHygiene.test.ts` | 2 |
| `generic-api-key` | `tests/evidence/t_4e1b6937/qa/round2/d1_ab_repro.py` | 1 |
| `generic-api-key` | `tests/evidence/t_4e1b6937/qa/round2/d1_r2_sensitivity.py` | 1 |
| `generic-api-key` | `tests/evidence/t_7dd3b960/gate-master.mjs` | 3 |
| `generic-api-key` | `tests/evidence/t_7dd3b960/gate-pr25.mjs` | 3 |

<details><summary>fingerprints</summary>

```
247dc22c6ad58c62b54a494a82a3c3386180efab:tests/evidence/t_7dd3b960/gate-master.mjs:generic-api-key:199
247dc22c6ad58c62b54a494a82a3c3386180efab:tests/evidence/t_7dd3b960/gate-master.mjs:generic-api-key:212
247dc22c6ad58c62b54a494a82a3c3386180efab:tests/evidence/t_7dd3b960/gate-master.mjs:generic-api-key:228
247dc22c6ad58c62b54a494a82a3c3386180efab:tests/evidence/t_7dd3b960/gate-pr25.mjs:generic-api-key:208
247dc22c6ad58c62b54a494a82a3c3386180efab:tests/evidence/t_7dd3b960/gate-pr25.mjs:generic-api-key:221
247dc22c6ad58c62b54a494a82a3c3386180efab:tests/evidence/t_7dd3b960/gate-pr25.mjs:generic-api-key:237
a4746466c7593fbfd7e428523b13657487109795:tests/evidence/t_4e1b6937/d1_sensitivity.py:generic-api-key:25
c8fa8590a673a1cb572a83f36ac7280851ebffcc:tests/evidence/t_4e1b6937/d1_sensitivity.py:generic-api-key:25
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/gate-fix.diff:generic-api-key:187
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/gate-fix.diff:generic-api-key:192
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/non-qa-marker-inventory.txt:generic-api-key:49
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/non-qa-marker-inventory.txt:generic-api-key:55
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/non-qa-marker-inventory.txt:generic-api-key:56
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/non-qa-marker-inventory.txt:generic-api-key:57
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/non-qa-marker-inventory.txt:generic-api-key:58
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/non-qa-marker-inventory.txt:generic-api-key:59
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/non-qa-marker-inventory.txt:generic-api-key:60
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/non-qa-marker-inventory.txt:generic-api-key:69
e23ca8a09e555c9b865318029dae2bba4bfff335:tests/evidence/t_338f47fd/non-qa-marker-inventory.txt:generic-api-key:9
e404deeaa676e356e745549c6b453da2ed412442:tests/evidence/t_4e1b6937/qa/round2/d1_ab_repro.py:generic-api-key:12
e404deeaa676e356e745549c6b453da2ed412442:tests/evidence/t_4e1b6937/qa/round2/d1_r2_sensitivity.py:generic-api-key:26
fa55051f19562eaf96bae463282439d3d0c6dc5e:tests/evidence/t_4e1b6937/qa/probeErrorShape.test.ts:generic-api-key:22
fa55051f19562eaf96bae463282439d3d0c6dc5e:tests/evidence/t_4e1b6937/qa/probeSecretHygiene.test.ts:generic-api-key:52
fa55051f19562eaf96bae463282439d3d0c6dc5e:tests/evidence/t_4e1b6937/qa/probeSecretHygiene.test.ts:generic-api-key:63
```

</details>

### G5 — Secret-guard test vectors (synthetic AWS access key id) (8 fingerprints)

| rule | file | fingerprints |
|---|---|---|
| `aws-access-key-id` | `scripts/qa/secret-guard.selftest.mjs` | 6 |
| `aws-access-key-id` | `tests/evidence/t_b51a1ff3/live-fire.txt` | 2 |

<details><summary>fingerprints</summary>

```
48b89a359b5771153bcbd267f6c0bc03bcb92d9f:tests/evidence/t_b51a1ff3/live-fire.txt:aws-access-key-id:26
732bc559fa33c327d20ad7364283283ddbda5a90:tests/evidence/t_b51a1ff3/live-fire.txt:aws-access-key-id:26
9f5daab3b9f664985c5e838ffd782de0e1a779c8:scripts/qa/secret-guard.selftest.mjs:aws-access-key-id:182
9f5daab3b9f664985c5e838ffd782de0e1a779c8:scripts/qa/secret-guard.selftest.mjs:aws-access-key-id:422
9f5daab3b9f664985c5e838ffd782de0e1a779c8:scripts/qa/secret-guard.selftest.mjs:aws-access-key-id:84
f9f38eb419740f862662be5c11477adcc5ac9e11:scripts/qa/secret-guard.selftest.mjs:aws-access-key-id:182
f9f38eb419740f862662be5c11477adcc5ac9e11:scripts/qa/secret-guard.selftest.mjs:aws-access-key-id:422
f9f38eb419740f862662be5c11477adcc5ac9e11:scripts/qa/secret-guard.selftest.mjs:aws-access-key-id:84
```

</details>

### G6 — telegram-token detections — every distinct value checked revoked (getMe = 401) (11 fingerprints)

| rule | file | fingerprints |
|---|---|---|
| `telegram-token` | `PROJECT_BRIEF.md` | 1 |
| `telegram-token` | `apps/services/api/tests/auth/security.test.ts` | 1 |
| `telegram-token` | `scripts/qa/secret-guard.selftest.mjs` | 1 |
| `telegram-token` | `tests/evidence/t_0af5aa3e/scan-final-gitleaks.txt` | 4 |
| `telegram-token` | `tests/evidence/t_b51a1ff3/reproduce-review.sh` | 1 |
| `telegram-token` | `tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt` | 3 |

| fingerprint | sha256(value)[:16] | getMe HTTP (2026-10-10) | identification |
|---|---|---|---|
| `40280562b11fe21291dd9bd13621b09e332678db:tests/evidence/t_b51a1ff3/reproduce-review.sh:telegram-token:77` | `6d51c6b0d4706124` | 401 | not identified in board evidence; dead (401) |
| `433181e890fb0a9bd1f6cd0e374ee6140c3af937:tests/evidence/t_0af5aa3e/scan-final-gitleaks.txt:telegram-token:40` | `62fe6fe5053a50ec` | 401 | original incident token (t_0af5aa3e / t_930fddbe / t_80fc0326); sha256 matches tests/evidence/t_e348e0b7/README.md |
| `433181e890fb0a9bd1f6cd0e374ee6140c3af937:tests/evidence/t_0af5aa3e/scan-final-gitleaks.txt:telegram-token:41` | `62fe6fe5053a50ec` | 401 | original incident token (t_0af5aa3e / t_930fddbe / t_80fc0326); sha256 matches tests/evidence/t_e348e0b7/README.md |
| `433181e890fb0a9bd1f6cd0e374ee6140c3af937:tests/evidence/t_0af5aa3e/scan-final-gitleaks.txt:telegram-token:53` | `62fe6fe5053a50ec` | 401 | original incident token (t_0af5aa3e / t_930fddbe / t_80fc0326); sha256 matches tests/evidence/t_e348e0b7/README.md |
| `433181e890fb0a9bd1f6cd0e374ee6140c3af937:tests/evidence/t_0af5aa3e/scan-final-gitleaks.txt:telegram-token:54` | `62fe6fe5053a50ec` | 401 | original incident token (t_0af5aa3e / t_930fddbe / t_80fc0326); sha256 matches tests/evidence/t_e348e0b7/README.md |
| `543c396d8bf4289492b80066a93e8c9f51de8c2a:PROJECT_BRIEF.md:telegram-token:87` | `62fe6fe5053a50ec` | 401 | original incident token (t_0af5aa3e / t_930fddbe / t_80fc0326); sha256 matches tests/evidence/t_e348e0b7/README.md |
| `9f5daab3b9f664985c5e838ffd782de0e1a779c8:scripts/qa/secret-guard.selftest.mjs:telegram-token:41` | `df5ccd96d61f23a3` | 401 | rotated value propagated by t_28951254 and later rotated again; sha256 matches tests/evidence/t_d20787de/scripts/*.py |
| `ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:telegram-token:516` | `aca3d28e22485ee2` | 401 | not identified in board evidence; dead (401) |
| `eb6044b8bb263182953dedd5af817cb01eeba6ad:tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt:telegram-token:22` | `62fe6fe5053a50ec` | 401 | original incident token (t_0af5aa3e / t_930fddbe / t_80fc0326); sha256 matches tests/evidence/t_e348e0b7/README.md |
| `eb6044b8bb263182953dedd5af817cb01eeba6ad:tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt:telegram-token:36` | `62fe6fe5053a50ec` | 401 | original incident token (t_0af5aa3e / t_930fddbe / t_80fc0326); sha256 matches tests/evidence/t_e348e0b7/README.md |
| `eb6044b8bb263182953dedd5af817cb01eeba6ad:tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt:telegram-token:8` | `62fe6fe5053a50ec` | 401 | original incident token (t_0af5aa3e / t_930fddbe / t_80fc0326); sha256 matches tests/evidence/t_e348e0b7/README.md |

<details><summary>fingerprints</summary>

```
40280562b11fe21291dd9bd13621b09e332678db:tests/evidence/t_b51a1ff3/reproduce-review.sh:telegram-token:77
433181e890fb0a9bd1f6cd0e374ee6140c3af937:tests/evidence/t_0af5aa3e/scan-final-gitleaks.txt:telegram-token:40
433181e890fb0a9bd1f6cd0e374ee6140c3af937:tests/evidence/t_0af5aa3e/scan-final-gitleaks.txt:telegram-token:41
433181e890fb0a9bd1f6cd0e374ee6140c3af937:tests/evidence/t_0af5aa3e/scan-final-gitleaks.txt:telegram-token:53
433181e890fb0a9bd1f6cd0e374ee6140c3af937:tests/evidence/t_0af5aa3e/scan-final-gitleaks.txt:telegram-token:54
543c396d8bf4289492b80066a93e8c9f51de8c2a:PROJECT_BRIEF.md:telegram-token:87
9f5daab3b9f664985c5e838ffd782de0e1a779c8:scripts/qa/secret-guard.selftest.mjs:telegram-token:41
ab33fba34e020ae46fd2878a1181377cd7eb23a4:apps/services/api/tests/auth/security.test.ts:telegram-token:516
eb6044b8bb263182953dedd5af817cb01eeba6ad:tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt:telegram-token:22
eb6044b8bb263182953dedd5af817cb01eeba6ad:tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt:telegram-token:36
eb6044b8bb263182953dedd5af817cb01eeba6ad:tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt:telegram-token:8
```

</details>


## Maintenance

* **A new finding on a PR or push** (`secret-scan` red): if it is a real
  secret, remove it, rotate it, and treat it as an incident. If it is a false
  positive, add its fingerprint — and only its fingerprint — to
  `.gitleaksignore`, and add a line to the matching group here (or a new group)
  explaining why. Get the fingerprint from the job log
  (`skipping finding`/`Fingerprint:` lines are printed with `--redact`).
* **The weekly `secret-scan-full-history` run is red**: a finding outside the
  baseline exists on some ref. Read the run log (values are redacted), find the
  ref with `git branch -r --contains <commit>`, and handle it as above. Never
  add an exclusion by path or by rule to make it green.
* **Never** generate the baseline with `--baseline-path` or commit a gitleaks
  JSON/SARIF report that was produced without `--redact`.

## Negative control (criterion 2)

_Pending: filled in by the evidence commit of this PR (t_76461419)._

