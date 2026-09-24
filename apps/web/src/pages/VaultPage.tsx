import { useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '../auth/SessionProvider'
import { useThemeStore } from '../stores/themeStore'
import { ApiClient } from '../api'
import './VaultPage.css'

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

  const { data: resources = [], isLoading, error, refetch } = useQuery({
    queryKey: ['resources'],
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
      const body = await client.get<ResourceRow[]>('/resources')
      return body
    },
    enabled: accessToken !== null,
    refetchInterval: false,
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

  if (isLoading) {
    return (
      <main id="main-content" tabIndex={-1} className="vault-page" data-theme={theme}>
        <h1 className="vault-heading">Vault</h1>
        <div className="vault-loading" role="status" aria-live="polite">
          Loading resources…
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main id="main-content" tabIndex={-1} className="vault-page" data-theme={theme}>
        <h1 className="vault-heading">Vault</h1>
        <div className="vault-error" role="alert" aria-live="assertive">
          <p>Failed to load resources.</p>
          <button type="button" className="vault-error-refresh" onClick={handleRefresh}>
            Retry
          </button>
        </div>
      </main>
    )
  }

  return (
    <main id="main-content" tabIndex={-1} className="vault-page" data-theme={theme}>
      <h1 className="vault-heading">Vault</h1>

      <div className="vault-toolbar">
        <span className="vault-count" aria-live="polite">
          {rows.length} resource{rows.length !== 1 ? 's' : ''}
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
        <p className="vault-empty">No resources yet.</p>
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
    </main>
  )
}
