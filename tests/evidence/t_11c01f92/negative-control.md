# Negative control — deliberately non-compliant checklist

This file intentionally omits the "Origin spoofing" theme, includes a case with no owning test path,
and embeds a real domain, to prove validate-checklist.mjs is non-vacuous.

## 4.1 Tampered Ciphertext
| ID | Negative case | Expected safe failure | Owning test path |
|---|---|---|---|
| CRY-01 | tampered ciphertext | decrypt fails | packages/crypto/src/__tests__/aead.test.ts |

## 4.2 Auth Abuse
| ID | Negative case | Expected safe failure | Owning test path |
|---|---|---|---|
| AUTH-01 | wrong password | 401 | apps/services/api/__tests__/auth.test.ts |
| AUTH-02 | missing owning path | 401 |  |

Reference to a real domain: https://github.com/example leaked here.
