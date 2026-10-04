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
- **Response timeline:** we aim to acknowledge reports within 5 business days and provide a status update within 10 business days. There is no fixed deadline for a fix; complex issues may require more time, and we will communicate any expected delay.
- **Authorized testing scope:** testing is welcome on the staging/recette environment only. Do not test against production, do not perform denial-of-service attacks, and do not attempt social engineering against users or maintainers. Out-of-scope activity includes credential stuffing, brute-force of auth endpoints, and any test that may degrade service for others.
- **Safe harbor:** reports made in good faith, within the authorized scope above, will not be the subject of legal action or disclosure to law enforcement. We ask reporters to avoid accessing, modifying, or exfiltrating user data beyond what is strictly necessary to demonstrate the issue.
- **Recognition:** with your permission, we acknowledge responsible reporters in the release notes and/or a hall-of-fame section. This is optional — you may request anonymity.

## CI security gates

- Secret scan (gitleaks / truffleHog) — fails on any real secret
- Dependency audit (npm audit / OSWASP) — fails on known vulnerable deps
- SAST (CodeQL or Semgrep) — configured in QA-001d
- No stack traces in production error responses

See [architecture/kanban/backlog.md](architecture/kanban/backlog.md) for the task that wires these into CI (QA-001d).
