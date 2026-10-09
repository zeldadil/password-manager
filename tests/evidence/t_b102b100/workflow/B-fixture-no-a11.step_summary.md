## QA sign-off gate — board audit

| field | value |
|---|---|
| ref | refs/heads/master |
| event | workflow_dispatch |
| board | <selftest-root>/board-a11.db |

### Bypasses and degradations

Counted on every audit. A degradation is **never** a card violation; it says what this audit could not check or what was waived.

| type | count | fails this audit? | cards |
|---|---|---|---|
| `A11_CI_STATE_UNVERIFIABLE` — CI state unverifiable — R9/R10 not evaluated | 0 | no (`--fail-on-a11` on, count 0) | — |

### Audit report (exit code 0)

```text
QA sign-off gate — audit (db: <selftest-root>/board-a11.db, epoch: 2026-09-17T15:00:00.000Z)
  enforced (done at/after epoch or pre-complete): 2  ·  pass: 2  ·  FAIL: 0
  bypasses & degradations (counted on every audit — never a card violation):
    A11 (CI state unverifiable — R9/R10 not evaluated): 0  ·  --fail-on-a11: pass
  ok   t_a11a0001  FE-970a A11-only: 100% compliant, title has a colon, a comma and a percent sign @frontend
  ok   t_a11a0002  FE-970b A11-only second card @frontend
```

---
_Reported by .github/workflows/qa-signoff-audit.yml (CI-001h). Not a required check on master: it reports, it does not gate merges._
