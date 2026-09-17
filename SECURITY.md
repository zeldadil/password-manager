# Security

This document summarises the security posture of the Password Manager project. The authoritative
threat model and crypto decisions live in [SEC-001](architecture/adr/SEC-001-threat-model.md).

## Threat model summary

SEC-001 covers 7 minimum attack vectors:

1. Local file / backup access
2. Partial API compromise
3. Hostile extension / page
4. Leakage via logs / errors / URLs / telemetry
5. Stolen device / unlocked session
6. Forgotten master password / corrupted backup / failed migration

## Crypto decisions summary (no secret values)

| Decision | Choice | Rationale |
|---|---|---|
| KDF | Argon2id (per SEC-001) | Memory-hard, resistant to GPU/ASIC brute force |
| AEAD | AES-256-GCM | Standard, audited, 128-bit authentication tag |
| Key derivation | Master password → KDF → vault key | Server never sees or stores master password |
| Nonce / IV | 12 bytes, random per encryption | GCM nonce uniqueness is critical |
| Integrity | GCM auth tag (built-in) | Detects tamper; decryption fails on mismatch |
| Lock / unlock | Vault key held in memory only, cleared on lock | Minimizes key exposure window |
| Recovery | Post-MVP — not in V1 scope | Backup key MVP deferred |
| Backup | Post-MVP — architecture prepared | Restore tested before shipping |
| Browser bridge | Vault key in extension memory only, Web Crypto | No offscreen document in MVP; content scripts never touch crypto |

Full detail, rationale, and absolute rules in [SEC-001](architecture/adr/SEC-001-threat-model.md).

## Absolute rules

- **No home-grown crypto.** Only standard, audited primitives.
- **No real secrets in code, logs, errors, URLs, or telemetry.** Synthetic fixtures only.
- **Positive AND negative tests per crypto change.** Tampered ciphertext must be rejected.
- **Migration / rollback strategy** must exist before any schema change touches encrypted data.
- **No plaintext master password or vault key ever logged, returned, or persisted** on the server.

## Disclosure policy

- Security issues: do not open a public issue. Contact the maintainers directly.
- All security-relevant changes must pass the SEC-001 threat-vector checklist before merge.
- Secret scanning (gitleaks / truffleHog) runs in CI on every push; a real secret fails the pipeline.

## CI security gates

- Secret scan (gitleaks / truffleHog) — fails on any real secret
- Dependency audit (npm audit / OSWASP) — fails on known vulnerable deps
- SAST (CodeQL or Semgrep) — configured in QA-001d
- No stack traces in production error responses

## Secrets in Kanban — absolute rule (SEC-001 extension, T_B51A1FF3)

**Status: Active — 2026-09-17**

A Kanban board is a durable, shared artifact: comment bodies, completion
summaries, run `result` fields, and run metadata are all stored in
`~/.hermes/kanban.db` and injected into the context of every worker dispatched
on a card, including workers with nothing to do with credential handling. A
secret in any durable board/run content is one careless copy away from a public
repo leak. The only distribution channel for secrets is the profile `.env` (or a
local file outside the repo); a worker that needs one reads it programmatically.

**Rule (non-negotiable):**

- Secrets never enter Kanban cards, comments, completion summaries, run `result`
  fields, evidence files, logs, or chat.
- The only distribution channel is the profile `.env` (or a local file outside
  the repo). A worker that needs a secret reads it programmatically from there.
- When a human needs to hand a secret to a worker, they write it into the
  profile's `.env` (or an out-of-repo local file) and tell the worker the
  profile or path — they never paste it into a card comment, completion summary,
  evidence file, or chat log.
- A `pre_tool_call` hook (`scripts/qa/secret-guard.mjs`, installed per-profile
  via `scripts/qa/hooks/install-secret-guard.sh`) blocks
  `kanban_comment` / `kanban_create` / `kanban_complete` calls whose text
  contains a secret-shaped value. The block reason quotes only rule ids, never
  the matched value. `fail_closed: true` — if the hook crashes or times out, the
  call is blocked. A kill switch (`~/.hermes/secret-guard.disabled`) exists for
  emergency operator override.
- Evidence under `tests/evidence/<task-id>/` must never contain real secrets.
  Synthetic fixtures only (per SEC-001 AR-4).

**Evaluation order / interaction with the QA sign-off gate (SEC-001 + QA-001h):**

The board runs two **independent** `pre_tool_call` hooks on every profile that
writes to the board (after rollout). Hermes evaluates `hooks.pre_tool_call`
entries in list order and applies the first block it encounters — whichever hook
fires first wins; a block short-circuits the call. Both hooks set
`fail_closed: true`, so a crash or timeout in either one blocks the call.

1. `scripts/qa/hooks/qa-signoff-gate.sh` → `scripts/qa/signoff-gate.mjs`
   matcher: `^kanban_complete$` — enforces the QA verdict + evidence rule
   (QA-001h, `t_430aa9a3`, documented in `QA_SIGN_OFF_GATE.md` on
   `qa/t_5455942d-gate-fix`).
2. `scripts/qa/hooks/secret-guard.sh` → `scripts/qa/secret-guard.mjs`
   matcher: `^(kanban_comment|kanban_create|kanban_complete)$` — enforces the
   no-secrets rule (SEC-001 extension, this card).

They are independent: the secret guard can block a `kanban_complete` whose
`result` or top-level `artifacts` contains a token even if the sign-off gate has
not yet run; the sign-off gate can block a clean `kanban_complete` that lacks a
verdict even though the secret guard passed. Neither hook silences the other —
there is no allowlist shared between them and no ordering dependency on
correctness.

**Cross-reference (open items):**
- `QA_SIGN_OFF_GATE.md` is not yet in this tree — it lives on
  `qa/t_5455942d-gate-fix` (unmerged). Once that branch merges, the sentence
  "documented in `QA_SIGN_OFF_GATE.md`" above becomes resolvable in-tree. Owner:
  `qa`. Until then the sign-off gate rule is documented by its own branch and by
  `t_430aa9a3`; this card's rule is self-contained in this section.

**Hook coverage:**

- Architect profile: installed + allowlisted + `fail_closed: true`
  (`tests/evidence/t_b51a1ff3/hooks-doctor.txt`).
- Selftest: 16/16 cases pass (`scripts/qa/secret-guard.selftest.mjs`).
- Live-fire: 9/9 cases pass (`tests/evidence/t_b51a1ff3/live-fire.txt`).
- No allowlist/exclusion may silence the guard (TEST_STRATEGY §12.2): the guard
  file itself contains no real credential (gitleaks + trufflehog clean on the
  guard source), and the only `.gitleaksignore` entry covers a historical leak
  in `a503e4d:PROJECT_BRIEF.md` — it does not exempt any hook or test file.

**Reference:** `scripts/qa/secret-guard.mjs` (gate logic), `scripts/qa/hooks/`
(hook shell wrapper + installer + verifier).

See [architecture/kanban/backlog.md](architecture/kanban/backlog.md) for the task that wires these into CI (QA-001d).
