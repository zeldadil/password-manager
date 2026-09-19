# Evidence — QA-001f (`t_11c01f92`): Negative Test Checklist

Deliverable: `tests/security/NEGATIVE_TEST_CHECKLIST.md` (the consolidated §6.3 checklist artifact).

Validator: `scripts/qa/validate-checklist.mjs`.

## Files

| File | What it proves |
|---|---|
| `checklist-validation-positive.txt` | Validator exits 0 on the deliverable: 5 acceptance-criteria themes present, §6.2 A–F covered, all 76 case IDs carry an owning test path, AR-4 hygiene clean, SEC-001 V1–V7 + AR-1…AR-6 referenced. |
| `checklist-validation-negative-control.txt` | Validator exits 1 on a deliberately non-compliant file (missing themes, a case with no owning path, an embedded real domain) — proves the validator is non-vacuous. |
| `negative-control.md` | The non-compliant control fixture itself. |

## Reproduction

```
node scripts/qa/validate-checklist.mjs tests/security/NEGATIVE_TEST_CHECKLIST.md        # expect exit 0
node scripts/qa/validate-checklist.mjs tests/evidence/t_11c01f92/negative-control.md    # expect exit 1
```

Run on Node v22.23.2. Commit: see branch `feature/t_11c01f92`.
