QA-VERDICT: pass — record repaired 2026-09-18 by QA-001i-fu1 (`t_4242bee8`). The token is the one recorded at completion (2026-09-17, comment above: "QA-001a verdict: PASS (self-validated) — complete"); this comment exists to repair the **evidence pointer** and is **not** a new verdict on the work. Evidence: tests/evidence/t_ac6a1f3f/README.md, tests/evidence/t_ac6a1f3f/, scripts/qa/validate-docs.mjs

**What was broken (measured).** `node scripts/qa/signoff-gate.mjs audit --db ~/.hermes/kanban.db --repo <full clone> --strict-history` reported on this card:

```
FAIL t_ac6a1f3f  R5_EVIDENCE_FILE_MISSING: evidence file named in the operative verdict
                 does not exist: <throwaway absolute path> (repo: <clone>; not found on any ref)
```

The operative verdict named a deliberately non-compliant **negative-control document created in a throwaway absolute path outside the repo**. That path is not committed and exists in no checkout, so the card's entire evidence set was unresolvable *to the audit* — even though the real evidence was already committed and passing. This is finding P2 of `docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md` §3.5: a pointer the audit cannot prove is not evidence, however good the artifact behind it is.

**Repair.** The pointer now names only committed artifacts, each resolvable on a ref of the clone with `git rev-list --max-count=1 --all -- <path>`:

| path | first commit on a ref |
|---|---|
| tests/evidence/t_ac6a1f3f/README.md | 332caa93 (`feature/t_ac6a1f3f`) |
| tests/evidence/t_ac6a1f3f/ | 332caa93 |
| scripts/qa/validate-docs.mjs | 332caa93 |

**The old pointer is history, not deleted.** It stays quoted in the comment above; the gate now reports it as the `A5_EVIDENCE_SUPERSEDED` advisory (correct scoping: only the operative verdict's paths are resolved). The fixture itself is **intentionally uncommitted** — it carries secret-shaped strings, which TEST_STRATEGY §7 / SEC-001 AR-4 forbid committing — and its captured run **is** committed at `tests/evidence/t_ac6a1f3f/doc-validation-negative-control.txt` (exit 1, all five check groups firing, alongside the exit-0 positive run). That transcript, not the fixture, is the durable proof that the validator is not vacuous, and it is what the repaired pointer leads to.

No content of the card is being re-verified or softened here: `pass` is the token recorded on 2026-09-17, and this repair changes no verdict.
