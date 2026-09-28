import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSession } from '../auth/SessionProvider'
import { useThemeStore } from '../stores/themeStore'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { ApiClient } from '../api'
import './VaultPage.css'

/** Debounce delay (ms) for the search bar (FE-003c) — long enough to
 *  collapse fast typing into one request, short enough to still feel
 *  responsive. */
const SEARCH_DEBOUNCE_MS = 300

export interface ResourceRow {
  id: string
  name: string
  username: string | null
  uri: string | null
  folderId: string | null
  folderName: string | null
  tags: readonly string[]
}

/**
 * Compact entrypoint for tests — returns the columns the task specifies so
 * unit tests can assert the contract without walking the DOM.
 */
export function vaultColumns() {
  return [
    { key: 'name', label: 'Name' },
    { key: 'username', label: 'Username' },
    { key: 'uri', label: 'URI' },
    { key: 'folder', label: 'Folder' },
    { key: 'tags', label: 'Tags' },
    { key: 'actions', label: 'Actions' },
  ]
}

export default function VaultPage() {
  const { accessToken } = useSession()
  const theme = useThemeStore((s) => s.theme)

  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS)
  const trimmedSearch = debouncedSearch.trim()

  const {
    data: resources = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    // Keying on the debounced term (not the raw input) means the query
    // only re-runs once typing settles, not on every keystroke.
    queryKey: ['resources', trimmedSearch],
    queryFn: async () => {
      const client = new ApiClient({
        baseUrl: '/api/v1',
        tokenStore: {
          getAccessToken: () => accessToken,
          getRefreshToken: () => null,
          setTokens: () => {},
          clear: () => {},
        },
      })
      // `search` is a virtual filter field the API resolves as a
      // case-insensitive substring match across name/username/uri
      // (BE-003h) — matches this task's own acceptance criterion.
      const path = trimmedSearch
        ? `/resources?filter[search]=${encodeURIComponent(trimmedSearch)}`
        : '/resources'
      // GET /resources returns the envelope body `{ data, pagination }`
      // (ADR-004 list-endpoint shape), not a bare array.
      const body = await client.get<{ data: ResourceRow[] }>(path)
      return body.data
    },
    enabled: accessToken !== null,
    refetchInterval: false,
    // Keep showing the previous result set while a new search term's
    // query is in flight, instead of unmounting the whole page into the
    // loading state on every search — which would also drop focus from
    // the search input mid-type.
    placeholderData: keepPreviousData,
  })

  const rows = useMemo(
    () =>
      resources.map((r) => ({
        ...r,
        username: r.username ?? '',
        uri: r.uri ?? '',
        folderName: r.folderName ?? '',
        tags: r.tags ?? [],
      })),
    [resources],
  )

  const handleRefresh = useCallback(() => {
    refetch().catch(() => {})
  }, [refetch])

  const handleClearSearch = useCallback(() => {
    setSearchInput('')
  }, [])

  const isSearching = trimmedSearch.length > 0

  const searchBar = (
    <div className="vault-search">
      <label htmlFor="vault-search-input" className="vault-search-label">
        Search
      </label>
      <input
        id="vault-search-input"
        type="search"
        className="vault-search-input"
        placeholder="Search by name, username, or URI"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />
      {searchInput ? (
        <button
          type="button"
          className="vault-search-clear"
          onClick={handleClearSearch}
          aria-label="Clear search"
        >
          Clear
        </button>
      ) : null}
    </div>
  )

  // The very first load (no cached data of any kind yet) still shows the
  // full blocking loading state — there's nothing useful to search yet.
  if (isLoading) {
    return (
      <div className="vault-page" data-theme={theme}>
        <h1 className="vault-heading">Vault</h1>
        <div className="vault-loading" role="status" aria-live="polite">
          Loading resources…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="vault-page" data-theme={theme}>
        <h1 className="vault-heading">Vault</h1>
        {searchBar}
        <div className="vault-error" role="alert" aria-live="assertive">
          <p>Failed to load resources.</p>
          <button type="button" className="vault-error-refresh" onClick={handleRefresh}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="vault-page" data-theme={theme}>
      <h1 className="vault-heading">Vault</h1>

      {searchBar}

      <div className="vault-toolbar">
        <span className="vault-count" aria-live="polite">
          {isFetching ? (
            'Searching…'
          ) : (
            <>
              {rows.length} resource{rows.length !== 1 ? 's' : ''}
              {isSearching ? ` matching “${trimmedSearch}”` : ''}
            </>
          )}
        </span>
        <button
          type="button"
          className="vault-refresh-button"
          onClick={handleRefresh}
          aria-label="Refresh resource list"
        >
          Refresh
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="vault-empty">
          {isSearching ? `No resources match “${trimmedSearch}”.` : 'No resources yet.'}
        </p>
      ) : (
        <div className="vault-table-wrap">
          <table className="vault-table">
            <thead>
              <tr>
                {vaultColumns().map((col) => (
                  <th key={col.key} scope="col" className="vault-th">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="vault-tr">
                  <td className="vault-td-name">
                    <Link
                      to={`/resources/${row.id}`}
                      className="vault-name-link"
                      aria-label={`Open ${row.name}`}
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="vault-td" data-th="Username">
                    {row.username || <span className="vault-empty-cell">—</span>}
                  </td>
                  <td className="vault-td" data-th="URI">
                    {row.uri || <span className="vault-empty-cell">—</span>}
                  </td>
                  <td className="vault-td" data-th="Folder">
                    {row.folderName || <span className="vault-empty-cell">—</span>}
                  </td>
                  <td className="vault-td" data-th="Tags">
                    {row.tags.length > 0 ? (
                      <ul className="vault-tags" aria-label={`Tags for ${row.name}`}>
                        {row.tags.map((tag) => (
                          <li key={tag} className="vault-tag">
                            {tag}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="vault-empty-cell">—</span>
                    )}
                  </td>
                  <td className="vault-td vault-td-actions" data-th="Actions">
                    <Link
                      to={`/resources/${row.id}`}
                      className="vault-action-link"
                      aria-label={`Edit ${row.name}`}
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
