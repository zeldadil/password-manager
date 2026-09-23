/** Pure API helpers for the lock/refresh flow (FE-002c).
 *
 * These are intentionally "dumb" fetch wrappers — no envelope parsing, no token
 * injection, no retry logic. They mirror the shape the existing UnlockPage uses
 * (raw fetch → check res.ok → parse JSON) so this task stays a thin layer on top
 * of the already-verified patterns.
 *
 * SEC-001: the only token we ever touch here is the refresh token sent to
 * /auth/refresh — and it is passed through from the in-memory store, never logged.
 */

export interface RefreshResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: 'Bearer'
}

export interface LockResponse {
  status: 'locked'
}

export async function postLock(accessToken: string): Promise<LockResponse> {
  const res = await fetch('/auth/lock', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + accessToken,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { message?: string })?.message ?? 'Lock failed')
  }
  return res.json() as Promise<LockResponse>
}

export async function postRefresh(refreshToken: string): Promise<RefreshResponse> {
  const res = await fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { message?: string })?.message ?? 'Refresh failed')
  }
  return res.json() as Promise<RefreshResponse>
}
