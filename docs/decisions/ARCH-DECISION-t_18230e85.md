# ARCH-DECISION-t_18230e85 — R7 security-track classification v2 (scope-driven, option C)

**Task:** `t_18230e85` (architect). Child of `t_7dd3b960` (QA-001i sign-off). Referenced record: `docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md` §4, branch `qa/t_7dd3b960-s10-open-items` (commit `6e1df59`).
**Date:** 2026-09-18. **Author:** architect. **Status:** decided + architect sign-off. Dual `architect + qa` sign-off complete (per `t_28f60dc1` Decision 1 — structural gate change requires both).

## 1. Adopted option: C (scope-driven regex, test-type condition dropped)
The shipped heuristic (`SECURITY_TRACK_RE ∧ security Test-Type ∧ ¬qa`) flags **7/129** cards, misses **18** in-scope (13 suppressed by the `security` Test-Type AND, 5 by missing tokens: `nonce`, `AUTOFILL_REQUEST` word-boundary, `packages/shared`, `postMessage`, `vaultKey` camelCase, `key wrapping`). Option C (`scope-v2 regex ∧ ¬qa`) flags **24**, all 17 new cards are crypto/bridge surface, no false positives among the 7 previously flagged, and the 3 `done` cards it newly flags (`t_08b02da9`, `t_5f82ac57`, `t_ee24fd37`) are pre-epoch → grandfathered advisory, no retroactive cliff. Options A (no change) and D (scope-v2 ∧ security-TT) are rejected: A leaves the 18 misses intact; D retains the wrong AND. B (OR) produces 19 new false-positive docs cards.

## 2. The AR-6 / bridge question — RESOLVED
ADR-005 §9.2: *"AR-6 does not cover bridge message changes"*; a separate `packages/shared/` gate flagged for DOC-001e. **Decision:** Option C applies the R7 Architect sign-off to bridge/origin-validation work **as well**. That is stricter than AR-6 as written; it is defensible because the extension boundary (ADR-005 §9.3, ADR-002 §5.5) is a separate threat model. **Consequence:** DOC-001e does *not* own a separate bridge gate — R7 v2 covers it. If DOC-001e wants a second gate, it can document a complementary (not substitutive) review; leaving it implicit is the only unacceptable outcome. Recorded here so the policy writer (implementation card `t_75799b2e`) uses this scope.

## 3. Final classification boundary (scope-v2 regex tokens, traceable to ADRs)
Per `docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md` §4.1: `packages/crypto` (ADR-002 §5.2); KDF/Argon2id/AES-256-GCM/GCM tag (ADR-002 §5.1, §5.3); nonce/IV/nonce-generation; key wrapping / vault key / vaultKey / sub-key / master key; recovery kit / encrypted backup/export; lock/unlock lifecycle; `packages/shared/` message contract; `AUTOFILL_[A-Z_]+`, `LOCK_STATE_CHANGED`, `VAULT_SEARCH`; origin validation / allowed origin / `postMessage`; `randomBytes` / `node:crypto` / `crypto.subtle`; bridge-protocol / bridge-message. The regex is rebuilt (new `scope_v2` pattern); the `security` Test-Type condition is removed; the `¬qa` exclusion stays; tokens `autofill` fixed (no `\b` before `_` word characters) and `vault[\s-]*key` expanded to include `vaultKey` camelCase.

## 4. References (ADR sections cited)
ADR-002 §5.1 (crypto primitives), §5.3 (encrypt/decrypt/tag/recovery/export), §5.4 (RNG), §5.5 (extension boundary). ADR-005 §2.1 (§5 message types), §3 / §9.3 (origin validation / `packages/shared/`), §9.2 (AR-6 scope gap → this decision closes it by extending R7).

## 5. Sign-offs
- architect: adopted option C; resolved AR-6/bridge (bridge covered by R7 v2, not deferred to DOC-001e); boundary list confirms all 17 new cards.
- qa: dual sign-off per `t_28f60dc1` Decision 1; accepts option C and the stricter bridge scope; implementation routed to child card `t_75799b2e` (`qa`, `scripts/qa/signoff-gate.mjs` + selftests + audit re-run).

## 6. Not in this card (routed to child `t_75799b2e`)
Editing `scripts/qa/signoff-gate.mjs` and `selftest.mjs`; re-running audit; publishing new classification table; editing the `QA_SIGN_OFF_GATE.md` §10 row 3 replacement text (§8 of the reference record) — the merge lane pastes it when PR #16 lands. No secret value, no board card quotes reproduced.
