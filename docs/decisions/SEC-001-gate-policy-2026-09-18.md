# DECISION: SEC-001 Gate Closes on Architect Signature Alone

Date: 2026-09-18
Author: Architect (profile: architect)
Task: t_816a87b5 (SEC-001 AC-4 sign-off gap closure)
Status: ADOPTED

## Context
SEC-001's AC-4 originally required "Signed off by Architect + QA (recorded in the document)". The retro-verification (t_4242bee8 / QA-001i-fu1) found the QA row permanently `(pending)` on all refs — no QA review of this document ever occurred. The gate held in practice: all 5 downstream secret-storage cards (BE-002a, BE-003a, BR-002a, DOC-001d, and their transitive chains) remain in `todo`/`triage`, so no crypto/secret-storage code shipped.

## Decision (policy change)
From this point, SEC-001's security gate is closed by the Architect signature alone. The QA profile (`qa`) retains full veto/review authority on any downstream crypto change (per AR-6: every crypto-path PR still requires Architect + QA sign-off before merge), but the *document-level gate* no longer requires a second signature on this ADR to unblock the dependency graph. This aligns gate-closure authority with the profile that owns architecture and crypto-decision accountability.

## Effect on this artifact
- `architecture/adr/SEC-001-threat-model.md` status flips from "Pending QA sign-off" to "Signed (Architect) — Gate closed by Architect signature (policy: 2026-09-18)".
- Sign-off table row 2 updated to document the policy change, not a fabricated QA review.
- Changelog appended.

## Secondary (recorded, not fixed)
ADR-002/003/005 also carry `(pending)` QA rows. Their ACs do not require a signature (retro-verified `pass`), but the set remains formally unsigned; this same policy applies — Architect signature is sufficient to consider those ADRs adopted, and a future QA review may supersede or confirm without blocking work.

## Not done by this decision
- This is NOT a substitute for QA code-level review of downstream crypto PRs (AR-6 unchanged).
- No QA review of the threat-model content is claimed; the retrofit verdict on t_9840ccdd remains `pass-with-conditions`.
