# FE-003h — Tag Management: Verification Evidence

**Task:** t_f666adb9 (FE-003h) · **Date:** 2026-09-30
**Branch:** feat/fe-003h-tag-management
**Commit:** f7a39e9 (`FE-003h: Tag Management — create/delete tags, assign/remove from resources`)
**PR:** #99 (open)

## Acceptance criteria

> Create/delete, assign/remove from resources

**Met.** Full tag management UI delivered: create tags (name + color), delete tags,
assign tags to resources by name, remove tags from resources.

## Components built

### Tag API client (`apps/web/src/api/tags.ts`)
- `tagApi(client)` — `list`, `get`, `create`, `update`, `delete`
- `resourceTagApi(client)` — `setTags(resourceId, tagIds)` (PATCH /resources/:id)
- Types: `TagInput`, `Tag`, `TagsEnvelope`, `TagEnvelope`, `ResourceTagPatch`

### TagsPage (`apps/web/src/pages/TagsPage.tsx`)
- Create tag form: name (required) + color picker / hex text input
- Tag grid: card per tag with color swatch, id snippet, delete button
- Resource tag assignment section: expandable resource list, assign by comma/space-separated
  tag name, per-tag remove button
- Loading / error / empty states for all three sections
- React Query: `useQuery(['tags'])` + 3 `useMutation` (create, delete, resourceTags)

## Test results (on rebased master, commit f7a39e9)

```bash
cd apps/web
pnpm vitest run src/api/tags.test.ts src/pages/TagsPage.test.tsx
→ 2 passed, 23 tests passed (9 api + 14 page)
```

### API tests (tags.test.ts) — 9 tests, all pass
- list with pagination params
- list without pagination params
- get a single tag by id
- create a tag
- create a tag with null color
- update a tag
- delete a tag
- resourceTagApi: replaces a resource's tags
- resourceTagApi: clears a resource's tags with an empty array

### Page tests (TagsPage.test.tsx) — 14 tests, all pass
- renders the heading and create form
- renders the tag list section with count
- renders each tag as a card with name and delete button
- creates a tag and clears the form on success
- shows a form error when creating with an empty name
- shows a form error on API failure
- deletes a tag on confirm
- shows a loading state while tags are fetching
- shows an error state when the tags API fails
- (resource tag assignment) renders resource items with current tags
- (resource tag assignment) expands a resource to show tag assignment controls
- (resource tag assignment) assigns tags to a resource by name
- (resource tag assignment) removes a tag from a resource
- (resource tag assignment) clears the assign input after a successful assign

## Fixes applied during verification

1. **TagsPage.resources query-cache read shape mismatch** — TagsPage read
   `queryClient.getQueryData(['resources'])` expecting `{ data: [...] }` (envelope body),
   but VaultPage's `queryFn` stores the raw array (`body.data`). Fixed to read the raw
   array directly: `getQueryData<Array<{id, name, tagIds}>>(['resources'])`.
2. **Create button disabled rule** — button was disabled when name was empty, preventing
   the empty-name validation error from ever rendering. Relaxed to `disabled={isPending}`
   only; validation happens in `handleCreate`.
3. **Resource-tag-assignment test — "No tags assigned" not found** — test asserted on
   collapsed resource. Fixed: expand the resource before asserting.

## Files changed (5 files, +1702/-71)

- `apps/web/src/api/tags.ts` — new (2411 bytes)
- `apps/web/src/api/tags.test.ts` — new (5420 bytes, 9 tests)
- `apps/web/src/pages/TagsPage.tsx` — modified (was `export default function TagsPage() { return <h1>Tags</h1> }`)
- `apps/web/src/pages/TagsPage.test.tsx` — new (22001 bytes, 14 tests)
- `apps/web/src/pages/TagsPage.css` — new (6356 bytes)

## Evidence sources

- PR #99: https://github.com/zeldadil/password-manager/pull/99
- CI run: https://github.com/zeldadil/password-manager/actions/runs/36751395050
- Commit f7a39e9 on feat/fe-003h-tag-management: `git log origin/feat/fe-003h-tag-management --oneline -1`
