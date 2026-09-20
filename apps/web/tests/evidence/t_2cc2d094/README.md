# Theme Toggle Implementation Evidence (FE-001l, t_2cc2d094)

## Source of truth

Commit 0a226f5 on branch feat/fe-001l-theme-toggle-wire.
PR: https://github.com/zeldadil/password-manager/pull/47

## Changes Made

### 1. `apps/web/src/components/layout/AppShell.tsx`

- Added imports: `useEffect` from 'react', `useThemeStore` from '../../stores/themeStore'.
- Extended JSDoc with the FE-001l sync contract (dataset.theme + meta color-scheme).
- Added `const theme = useThemeStore((s) => s.theme)` selector.
- Added `useEffect(() => { ... }, [theme])` that:
  - sets `document.documentElement.dataset.theme = theme`
  - ensures a `<meta name="color-scheme">` exists in `<head>` (creates it if absent)
  - sets `meta.content = theme === 'dark' ? 'dark' : 'light'`
- No other logic changed; the Outlet/Sidebar/Header tree is identical.

### 2. `Header.tsx`

- Added import: `useThemeStore` from '../../stores/themeStore'.
- Added `const { theme, toggleTheme } = useThemeStore()` inside the component.
- Added a theme toggle button between the Lock button and the user menu:
  - `type="button"`, `className="app-header__theme-toggle"`
  - `onClick={toggleTheme}`
  - `aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}`
  - `title` matches aria-label
  - `aria-pressed={theme === 'dark'}`
  - label text: 'Light' when dark, 'Dark' when light

### 3. `themeToggle.test.ts`

- Updated the documented gap comment
- Replaced the "no theme toggle control in the UI yet" gap paragraph with:
  > "The theme-toggle control (the button + the AppShell useEffect that writes
  > `data-theme` / `meta[name=color-scheme]` from `useThemeStore.theme`) is wired
  > in FE-001l (AppShell.tsx + Header.tsx); these tests cover the store contract
  > only and do not fake the DOM wiring."

## Acceptance Criteria

- [x] `document.documentElement.dataset.theme` reflects `useThemeStore.theme` on load and on toggle
- [x] A visible control exists to change theme (toggle button in Header)
- [x] `themeToggle.test.ts`'s documented gap is closed (comment updated)

## Validation run

```
$ cd apps/web && pnpm test:unit
Test Files  20 passed (20)
Tests       164 passed (164)

$ pnpm run typecheck
(no errors)
```

## Gap closure check (pre vs post)

Before this PR, on master:

```
$ git grep -rn "data-theme|dataset\.theme|documentElement" apps/web/src/
# only CSS selectors (theme.css) + test assertions; zero application-code writes
```

After this PR (diff verified on PR #47):

```
apps/web/src/components/layout/AppShell.tsx:
  import { useThemeStore } from '../../stores/themeStore'
  root.dataset.theme = theme
  meta[name="color-scheme"]
```

## Scope boundary

Sidebar-collapse wiring (the other half of t_2162d273's decision, owned by FE-003b / t_aca6ed13) is a separate card and is out of scope for this task.
