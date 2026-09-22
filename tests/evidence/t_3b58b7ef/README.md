# Evidence — FE-002a: Login Page (t_3b58b7ef)

**Task:** FE-002a — `/login`: master password input, submit → POST /auth/unlock, redirect to /vault on success
**Branch:** `feature/t_3b58b7ef`
**Commit:** `5ae5879e81e95ab8e59cdfafe96f8521ce1a8071` — "FE-002a: Login page with POST /auth/unlock + unit tests"
**PR:** #56 (open, `feature/t_3b58b7ef → master`)

---

## 1. Implementation

| File | Role |
|---|---|
| `apps/web/src/pages/LoginPage.tsx` | Login form: email + master password inputs, POST `/auth/unlock`, redirect to `/vault` on 200, error display + loading state |
| `apps/web/src/pages/LoginPage.test.tsx` | Unit tests (4 cases — see §3) |
| `apps/web/src/pages/VaultPage.tsx` | Semantic `<main>` wrapper (minimal target page for redirect assertion) |
| `apps/web/src/routes.tsx` | Flat route table — `/login`, `/unlock`, `/vault`, `/resources/:id`, `/folders`, `/tags`, `/settings`, `/generator`, plus `/` and `*` → `/login` |

LoginPage accepts a master password (`type=password`, `autoComplete=off`) and email (`type=email`, `autoComplete=username`), POSTs `{ masterPassword, email }` to `/auth/unlock` as JSON, and on a 200 response navigates to `/vault` with `replace: true`. Non-200 responses surface `data.message` in a `role="alert"` paragraph; network errors surface a fixed message. Submit is disabled while loading or when either field is empty.

---

## 2. Acceptance criteria — coverage

**AC:** `/login`: master password input (type=password, autocomplete=off), submit → POST /auth/unlock, redirect to /vault on success

| AC clause | Where covered |
|---|---|
| `/login` route renders | `routes.tsx` line 16 — `{ path: '/login', element: <LoginPage /> }` |
| master password input, type=password | `LoginPage.tsx:58-67` — `<input type="password" autoComplete="off" …>` |
| master password input, autocomplete=off | same — `autoComplete="off"` |
| submit → POST /auth/unlock | `LoginPage.tsx:18-22` — `fetch('/auth/unlock', { method: 'POST', … })` |
| payload shape | `LoginPage.tsx:21` — `body: JSON.stringify({ masterPassword, email })` |
| redirect to /vault on success | `LoginPage.tsx:28` — `navigate('/vault', { replace: true })` inside the `res.ok` branch |
| test fixtures use reserved-domain data | `LoginPage.test.tsx:48-49` — `user@example.test` (reserved per RFC 2606) |

---

## 3. Test results

**Suite:** `apps/web/src/pages/LoginPage.test.tsx`
**Tool:** vitest 2.1.8, jsdom environment
**Result:** 4/4 passed

```
 RUN  v2.1.8 /home/sap/.hermes/kanban/workspaces/t_3b58b7ef/apps/web
 ✓ src/pages/LoginPage.test.tsx (4 tests) 620ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Test cases:

1. **renders the heading and both required inputs** — asserts `h1` "Login", email input `type=email` + `autocomplete=username`, master password input `type=password` + `autocomplete=off`.
2. **POSTs masterPassword + email to /auth/unlock and redirects to /vault on success** — mocks `fetch` to return 200, fills both fields, clicks submit, asserts `/auth/unlock` called once with body containing both values, then asserts the Vault heading appears (redirect).
3. **shows an error message when the server returns 401** — mocks 401 `{ message: 'Invalid credentials' }`, asserts `role="alert"` paragraph shows that text.
4. **disables the submit button while loading** — mocks a 50ms delay, asserts button not disabled before click and disabled (label "Signing in…") after click.

Fixtures: `user@example.test` + `correct-horse-battery-staple` / `wrong-password` — all reserved/example data only; no real credentials.

---

## 4. Commands re-run for this evidence

From `apps/web/`:

```bash
npx vitest run src/pages/LoginPage.test.tsx
```

Output: 4/4 pass (see §3).

---

## 5. Security-relevant notes

- Master password field uses `autoComplete="off"` (AC requirement, `LoginPage.tsx:61`).
- No secret value is logged or rendered in test output — mocks return opaque tokens (`'tok'`, `'ref'`); test assertions check payload containment without printing the submitted password.
- `noValidate` on the form (line 38) — validation is handled client-side via `required` + JS; not relying on browser autofill heuristics for the master password field.
