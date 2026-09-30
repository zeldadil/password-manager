import { useCallback, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/SessionProvider'
import { ApiClient } from '../api'
import { tagApi, resourceTagApi, type Tag } from '../api/tags'
import './TagsPage.css'

export default function TagsPage() {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [createName, setCreateName] = useState('')
  const [createColor, setCreateColor] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set())
  const [resourceTagInput, setResourceTagInput] = useState<string>('')
  const [patchingResourceId, setPatchingResourceId] = useState<string | null>(null)

  const client = useCallback(
    () =>
      new ApiClient({
        baseUrl: '/api/v1',
        tokenStore: {
          getAccessToken: () => accessToken,
          getRefreshToken: () => null,
          setTokens: () => {},
          clear: () => {},
        },
      }),
    [accessToken],
  )

  const tagClient = tagApi(client())
  const resourceTagClient = resourceTagApi(client())

  const {
    data: tagsEnvelope,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagClient.list(),
    enabled: accessToken !== null,
    refetchInterval: false,
  })

  const tags: Tag[] = tagsEnvelope?.data ?? []

  const createMutation = useMutation({
    mutationFn: (input: { name: string; color: string | null }) => tagClient.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      setCreateName('')
      setCreateColor('')
      setCreateError(null)
    },
    onError: (err) => {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Failed to create tag'
      setCreateError(message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tagClient.delete(id),
    onMutate: (id) => setDeletingId(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      setDeletingId(null)
    },
    onError: () => {
      setDeletingId(null)
    },
  })

  const resourceTagsMutation = useMutation({
    mutationFn: ({ resourceId, tagIds }: { resourceId: string; tagIds: string[] }) =>
      resourceTagClient.setTags(resourceId, tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] })
      setPatchingResourceId(null)
      setResourceTagInput('')
    },
    onError: () => {
      setPatchingResourceId(null)
      setResourceTagInput('')
    },
  })

  const handleCreate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = createName.trim()
      if (!trimmed) {
        setCreateError('Tag name is required')
        return
      }
      setCreateError(null)
      createMutation.mutate({ name: trimmed, color: createColor })
    },
    [createName, createColor, createMutation],
  )

  const handleDelete = useCallback(
    (id: string) => {
      if (confirm('Delete this tag? It will be removed from all resources that use it.')) {
        deleteMutation.mutate(id)
      }
    },
    [deleteMutation],
  )

  const resources = (() => {
    // VaultPage (FE-003c) keys its query as ['resources', trimmedSearch],
    // so the idle key is ['resources', '']. Read everything under the
    // ['resources'] prefix and use the most recent non-empty entry.
    const entries = queryClient.getQueriesData({ queryKey: ['resources'] })
    for (let i = entries.length - 1; i >= 0; i--) {
      const [, raw] = entries[i]
      if (Array.isArray(raw)) return raw as Array<{ id: string; name: string; tagIds: string[] }>
    }
    return []
  })()

  const toggleResourceExpand = useCallback((id: string) => {
    setExpandedResources((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleResourceTagAssign = useCallback(
    (resourceId: string) => {
      const raw = resourceTagInput.trim()
      if (!raw) return
      // Comma or space separated tag names — resolve to ids from current tag list.
      const names = raw
        .split(/[, ]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const nameToId = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]))
      const ids = names
        .map((n) => nameToId.get(n.toLowerCase()))
        .filter((id): id is string => id !== undefined)
      if (ids.length === 0) return
      resourceTagsMutation.mutate({ resourceId, tagIds: ids })
    },
    [resourceTagInput, tags, resourceTagsMutation],
  )

  const removeResourceTag = useCallback(
    (resourceId: string, tagId: string) => {
      const current = resources.find((r) => r.id === resourceId)
      if (!current) return
      const next = current.tagIds.filter((t) => t !== tagId)
      resourceTagsMutation.mutate({ resourceId, tagIds: next })
    },
    [resources, resourceTagsMutation],
  )

  if (isLoading) {
    return (
      <div className="tags-page">
        <h1 className="tags-heading">Tags</h1>
        <div className="tags-loading" role="status" aria-live="polite">
          Loading tags…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="tags-page">
        <h1 className="tags-heading">Tags</h1>
        <div className="tags-error" role="alert" aria-live="assertive">
          <p>Failed to load tags.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="tags-page">
      <h1 className="tags-heading">Tags</h1>

      {/* ── Create tag form ── */}
      <section className="tags-section" aria-labelledby="tags-create-heading">
        <h2 id="tags-create-heading" className="tags-section-title">
          Create tag
        </h2>
        <form onSubmit={handleCreate} className="tags-create-form" noValidate>
          <div className="tags-create-row">
            <label className="tags-label" htmlFor="tag-name">
              Name
            </label>
            <input
              id="tag-name"
              ref={nameInputRef}
              type="text"
              className="tags-input"
              placeholder="e.g. Work"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              disabled={createMutation.isPending}
              autoComplete="off"
            />
          </div>
          <div className="tags-create-row">
            <label className="tags-label" htmlFor="tag-color">
              Color
            </label>
            <input
              id="tag-color"
              type="color"
              className="tags-color-input"
              value={createColor}
              onChange={(e) => setCreateColor(e.target.value)}
              disabled={createMutation.isPending}
            />
            <label className="tags-label" htmlFor="tag-color-text">
              Hex
            </label>
            <input
              id="tag-color-text"
              type="text"
              className="tags-color-text"
              value={createColor}
              onChange={(e) => setCreateColor(e.target.value)}
              disabled={createMutation.isPending}
              pattern="^#[0-9a-fA-F]{6}$"
              title="Hex color, e.g. 6-digit hex"
            />
          </div>
          {createError && (
            <p className="tags-form-error" role="alert">
              {createError}
            </p>
          )}
          <div className="tags-create-actions">
            <button
              type="submit"
              className="tags-button tags-button--primary"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating…' : 'Create tag'}
            </button>
          </div>
        </form>
      </section>

      {/* ── Tag list ── */}
      <section className="tags-section" aria-labelledby="tags-list-heading">
        <h2 id="tags-list-heading" className="tags-section-title">
          Tags ({tags.length})
        </h2>
        {tags.length === 0 ? (
          <p className="tags-empty">No tags yet. Create one above.</p>
        ) : (
          <ul className="tags-grid" role="list" aria-label="Tags">
            {tags.map((tag) => (
              <li key={tag.id} className="tags-card">
                <div className="tags-card__header">
                  <span
                    className="tags-card__color"
                    style={{ backgroundColor: tag.color ?? 'var(--border)' }}
                    aria-hidden="true"
                  />
                  <span className="tags-card__name">{tag.name}</span>
                </div>
                <div className="tags-card__meta">
                  <span className="tags-card__id">{tag.id.slice(0, 8)}…</span>
                </div>
                <div className="tags-card__actions">
                  <button
                    type="button"
                    className="tags-button tags-button--danger"
                    onClick={() => handleDelete(tag.id)}
                    disabled={deletingId === tag.id}
                    aria-label={`Delete tag ${tag.name}`}
                  >
                    {deletingId === tag.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Resource tag assignments ── */}
      <section className="tags-section" aria-labelledby="tags-assign-heading">
        <h2 id="tags-assign-heading" className="tags-section-title">
          Assign tags to resources
        </h2>
        {resources.length === 0 ? (
          <p className="tags-empty">No resources available to tag.</p>
        ) : (
          <ul className="tags-resource-list" role="list" aria-label="Resources">
            {resources.map((resource) => {
              const isExpanded = expandedResources.has(resource.id)
              return (
                <li key={resource.id} className="tags-resource-item">
                  <button
                    type="button"
                    className="tags-resource-header"
                    onClick={() => toggleResourceExpand(resource.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`resource-tags-${resource.id}`}
                  >
                    <span className="tags-resource-name">{resource.name}</span>
                    <span className="tags-resource-toggle" aria-hidden="true">
                      {isExpanded ? '−' : '+'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div
                      id={`resource-tags-${resource.id}`}
                      className="tags-resource-body"
                      role="region"
                      aria-labelledby={`resource-tags-${resource.id}-btn`}
                    >
                      <p className="tags-resource-current">
                        {resource.tagIds.length === 0
                          ? 'No tags assigned'
                          : resource.tagIds
                              .map((id) => {
                                const tag = tags.find((t) => t.id === id)
                                return tag ? tag.name : id.slice(0, 8) + '…'
                              })
                              .join(', ')}
                      </p>
                      <div className="tags-resource-assign">
                        <label className="tags-label" htmlFor={`assign-input-${resource.id}`}>
                          Add tags by name (comma or space separated):
                        </label>
                        <input
                          id={`assign-input-${resource.id}`}
                          type="text"
                          className="tags-input"
                          placeholder="e.g. Work, Production"
                          value={resourceTagInput}
                          onChange={(e) => setResourceTagInput(e.target.value)}
                          disabled={resourceTagsMutation.isPending || patchingResourceId !== null}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleResourceTagAssign(resource.id)
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="tags-button tags-button--secondary"
                          onClick={() => handleResourceTagAssign(resource.id)}
                          disabled={
                            resourceTagsMutation.isPending ||
                            patchingResourceId !== null ||
                            !resourceTagInput.trim()
                          }
                        >
                          {resourceTagsMutation.isPending ? 'Assigning…' : 'Assign'}
                        </button>
                      </div>
                      <ul
                        className="tags-resource-tag-list"
                        role="list"
                        aria-label={`Tags for ${resource.name}`}
                      >
                        {resource.tagIds.map((tagId) => {
                          const tag = tags.find((t) => t.id === tagId)
                          if (!tag) return null
                          return (
                            <li key={tagId} className="tags-resource-tag">
                              <span
                                className="tags-resource-tag__color"
                                style={{ backgroundColor: tag.color ?? 'var(--border)' }}
                                aria-hidden="true"
                              />
                              <span className="tags-resource-tag__name">{tag.name}</span>
                              <button
                                type="button"
                                className="tags-button tags-button--ghost"
                                onClick={() => removeResourceTag(resource.id, tagId)}
                                disabled={resourceTagsMutation.isPending}
                                aria-label={`Remove ${tag.name} from ${resource.name}`}
                              >
                                ×
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
