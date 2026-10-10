## 1. Classification over every card (221 cards on the snapshot)

| | v1 (master @ 626feb7) | v2 (scope-v2, this branch) |
|---|---|---|
| security-track cards | 8 | 45 |
| … of which `done` | 3 | 21 |
| … of which `done` before the gate epoch (grandfathered → advisory) | 1 | 5 |
| dropped by v2 (flagged by v1, not by v2) | — | 0 |

### 1.1 Every card v2 classifies as security-track

| card | status | assignee | pre-epoch done | v1 | v1 miss reason | scope-v2 tokens matched | title |
|---|---|---|---|---|---|---|---|
| `t_08b02da9` | done | architect | yes | no | v1 Test-Type AND | `bridge[\s_-]*(?:protocol\|message)` `autofill` `origin[\s_-]*validation` | ADR-005: Extension Bridge Protocol |
| `t_0ecb0c45` | blocked |  |  | no | v1 Test-Type AND | `Argon2id` | RELEASE CHECK (HUMAN): mobile Safari unlock test (Argon2id, SEC-001 parameters) |
| `t_144763e4` | blocked |  |  | no | v1 Test-Type AND | `Argon2id` | HUMAN GATE: mobile Safari conformance check (SEC-001, Argon2id) — condition 2 of |
| `t_18230e85` | done | architect |  | YES |  | `crypto[\s_-]*(?:primitive\|implementation\|boundar(?:y\|ies)\|module\|package)` `KDF` `(?<![\p{L}\p{N}])nonce` `key[\s_-]*wrap` `vault[\s_-]*key(?!board)` `recovery[\s_-]*(?:kit\|key)` `backup[\s_-]*(?:export\|dump)` `packages/shared` `bridge[\s_-]*(?:protocol\|message)` `autofill` `origin[\s_-]*validation` `postMessage` | QA-001i-fu4: ARCH decision — R7 security-track classification v2 (scope-driven)  |
| `t_18a945c2` | done | docs |  | no | v1 keyword miss | `origin[\s_-]*validation` | Draft Threat Model Summary section |
| `t_1f98942a` | triage | browser |  | no | v1 Test-Type AND | `autofill` | BR-001d: Implement browser extension popup with search, resource list, autofill, |
| `t_3ca45da2` | done | architect | yes | no | v1 keyword miss | `crypto[\s_-]*(?:primitive\|implementation\|boundar(?:y\|ies)\|module\|package)` | ADR-002: Overall Architecture |
| `t_3f1b0521` | blocked | default |  | no | v1 keyword miss | `KDF` | HUMAN GATE: approve start of Option B implementation |
| `t_4278a1dc` | done | backend |  | YES |  | `vault[\s_-]*key(?!board)` | BE-002e: Wrong-password Handling |
| `t_42ecc3e6` | done | architect |  | no | v1 Test-Type AND | `KDF` `Argon2id` `vault[\s_-]*key(?!board)` | FOLLOW-UP: answer 2 specific threat-model questions on t_e88bcc25's scoping plan |
| `t_4d0c8439` | done | backend |  | no | v1 Test-Type AND | `KDF` `vault[\s_-]*key(?!board)` | BE-002b: Unlock Endpoint |
| `t_4f42e589` | triage | browser |  | no | v1 keyword miss | `origin[\s_-]*validation` `sender\.origin` | BR-001f: Implement background origin validation for moz-extension and API domain |
| `t_5f82ac57` | done | architect | yes | no | v1 keyword miss | `packages/shared` | ARC-001e-Repo Structure + Root Config |
| `t_775eb704` | triage | browser |  | no | v1 Test-Type AND | `master[\s_-]*key(?!board)` `lock[/-]unlock` `autofill` `origin[\s_-]*validation` `allowed[\s_-]*origin` `sender\.origin` | BR-001b: Implement background.ts service worker with lifecycle, vault session st |
| `t_7b33595a` | triage | browser |  | YES |  | `vault[\s_-]*key(?!board)` | BR-002h: Security Tests |
| `t_7c0ce425` | done | architect |  | no | v1 Test-Type AND | `KDF` `Argon2id` | CONDITION 1: key separation — HKDF-derived auth verifier + encryption key (Optio |
| `t_83dc1b35` | triage | browser |  | no | v1 keyword miss | `vault[\s_-]*session[\s_-]*sync` `postMessage` | BR-002a: Vault Session Sync |
| `t_8e4c8bfa` | triage | browser |  | no | v1 Test-Type AND | `autofill` | BR-003e: E2E Tests |
| `t_8f551794` | done | architect |  | no | v1 Test-Type AND | `KDF` `vault[\s_-]*key(?!board)` | RESPEC: password-change flow (Option B: no master password to the server) |
| `t_91964616` | done | backend |  | no | v1 Test-Type AND | `KDF` | BE-002f: Unit Tests |
| `t_93cf5611` | todo | architect |  | no | v1 Test-Type AND | `KDF` `AEAD` `(?<![\p{L}\p{N}])nonce` `\bIVs?\b` `lock[/-]unlock` | DOC-001d: Create SECURITY.md with threat model, disclosure policy, and crypto de |
| `t_95852ebe` | archived | architect |  | no | v1 Test-Type AND | `KDF` `Argon2id` | SPEC: unified auth protocol (registration, 2-step unlock, DB-leak statement) |
| `t_974b5e77` | triage | browser |  | YES |  | `crypto[\s_-]*(?:primitive\|implementation\|boundar(?:y\|ies)\|module\|package)` `vault[\s_-]*key(?!board)` `autofill` | BR-002c: Crypto Boundary + Autofill Decryption |
| `t_979847fc` | triage | browser |  | no | v1 Test-Type AND | `autofill` | BR-002g: Integration Tests |
| `t_9840ccdd` | done | architect | yes | YES |  | `KDF` `AEAD` `(?<![\p{L}\p{N}])nonce` `\bIVs?\b` `lock[/-]unlock` | SEC-001-Threat Model + Security Gate |
| `t_aac0f0c2` | triage | browser |  | no | v1 Test-Type AND | `autofill` | BR-001c: Implement content.ts with form detection, icon injection, and backgroun |
| `t_acd800fe` | triage | browser |  | YES |  | `autofill` | BR-002d: Message Validation + Rate Limiting |
| `t_aeccec51` | done | architect |  | no | v1 Test-Type AND | `KDF` `Argon2id` `vault[\s_-]*key(?!board)` | RESPEC: unified auth protocol (registration, 2-step unlock, stored fields, DB-le |
| `t_b1a8b77e` | triage | browser |  | YES |  | `vault[\s_-]*key(?!board)` | BR-002e: Vault Key Memory Lifetime |
| `t_b37ce45a` | done | architect |  | no | v1 Test-Type AND | `KDF` `Argon2id` | SPIKE: RFC 9106 test vectors, hash-wasm root-cause, cross-browser Argon2id evide |
| `t_b51bf4b9` | done | backend |  | no | v1 keyword miss | `\bIVs?\b` | BE-003c: Secret Schema |
| `t_bc7a8dfa` | todo | docs |  | no | v1 Test-Type AND | `autofill` | Create data flow diagram |
| `t_bc8335fe` | done | architect |  | no | v1 Test-Type AND | `Argon2id` | CHECK: argon2-browser maintenance and security status (condition 1 of Ze's libra |
| `t_bf583105` | triage |  |  | no | v1 Test-Type AND | `Argon2id` | RELEASE v1 (placeholder — à spécifier, ne pas exécuter) |
| `t_c7258993` | todo | frontend |  | YES |  | `vault[\s_-]*key(?!board)` | FE-003i: Client-side Decryption + Optimistic Updates |
| `t_c8f29722` | todo | architect |  | no | v1 Test-Type AND | `bridge[\s_-]*(?:protocol\|message)` | DOC-001c: Architecture Docs |
| `t_d3074f1c` | todo | docs |  | no | v1 Test-Type AND | `crypto[\s_-]*(?:primitive\|implementation\|boundar(?:y\|ies)\|module\|package)` | Create component diagram |
| `t_d31b31ee` | todo | backend |  | no | v1 Test-Type AND | `Argon2id` | ARC: adopt argon2-browser (pinned) + permanent Argon2id conformance check |
| `t_d853034e` | archived | architect |  | no | v1 Test-Type AND | `KDF` `\bIVs?\b` `vault[\s_-]*key(?!board)` | SPEC: password-change flow (verifier rotation, vault-key re-wrap, session invali |
| `t_dd9eb295` | done | architect |  | no | v1 Test-Type AND | `packages/crypto` `KDF` `AEAD` `Argon2id` `GCM[\s_-]*tag` `vault[\s_-]*key(?!board)` | SECURITY: unlock.ts self-wrap forces server to reconstruct plaintext vault key o |
| `t_e4341d18` | done | backend |  | no | v1 keyword miss | `(?<![\p{L}\p{N}])nonce` `\bIVs?\b` | BE-003k: Security Tests |
| `t_e5142129` | triage | browser |  | no | v1 keyword miss | `packages/shared` `autofill` `VAULT_SEARCH` | BR-001e: Define shared message protocol types (AUTOFILL_REQUEST, AUTOFILL_RESPON |
| `t_e88bcc25` | done | architect |  | no | v1 Test-Type AND | `KDF` `AEAD` `Argon2id` `vault[\s_-]*key(?!board)` | SCOPING: rework BE-002a register/unlock so server stops receiving master passwor |
| `t_ee24fd37` | done | architect | yes | no | v1 Test-Type AND | `packages/crypto` `packages/shared` | REPO-BLOCKER: pnpm workspace manifest uncommitted — CI install cannot resolve wo |
| `t_fe0be554` | done | docs |  | no | v1 Test-Type AND | `KDF` `Argon2id` | Draft Crypto Decisions Summary section |

### 1.2 Exempt by ¬qa (scope token present, assignee `qa`): 14 cards

`t_1569312b` `t_16f8ad84` `t_4242bee8` `t_4de1f6aa` `t_6b1528aa` `t_70cf2f21` `t_75799b2e` `t_90a4bd73` `t_99bc64ff` `t_9d5c5286` `t_c02b7770` `t_ce76ba78` `t_fe3b76ea` `t_ffc9034d`

## 2. `audit --strict-history` before / after (same snapshot, same command)

| | before (v1) | after (scope-v2) |
|---|---|---|
| audited cards | 146 | 146 |
| FAIL | 49 | 49 |
| audited cards classified security-track | 3 | 21 |
| R7 violations | 0 | 0 |
| A17 advisories (scope-v2, completed before the R7 v2 epoch, no Architect sign-off) | 0 | 15 |

### 2.1 Cards whose classification or violations changed: 18

| card | status | security-track before → after | violations before | violations after | A17 advisory after |
|---|---|---|---|---|---|
| `t_08b02da9` | done | false → true | — | — | yes |
| `t_18a945c2` | done | false → true | R1, R4 | R1, R4 | yes |
| `t_3ca45da2` | done | false → true | — | — | yes |
| `t_42ecc3e6` | done | false → true | R2 | R2 | yes |
| `t_4d0c8439` | done | false → true | — | — | yes |
| `t_5f82ac57` | done | false → true | R1, R4, A1 | R1, R4, A1 | yes |
| `t_7c0ce425` | done | false → true | — | — |  |
| `t_8f551794` | done | false → true | — | — | yes |
| `t_91964616` | done | false → true | — | — | yes |
| `t_aeccec51` | done | false → true | R2 | R2 |  |
| `t_b37ce45a` | done | false → true | — | — | yes |
| `t_b51bf4b9` | done | false → true | — | — | yes |
| `t_bc8335fe` | done | false → true | — | — | yes |
| `t_dd9eb295` | done | false → true | — | — | yes |
| `t_e4341d18` | done | false → true | — | — | yes |
| `t_e88bcc25` | done | false → true | R2 | R2 |  |
| `t_ee24fd37` | done | false → true | R1, R4, A1 | R1, R4, A1 | yes |
| `t_fe0be554` | done | false → true | R1, R4 | R1, R4 | yes |

