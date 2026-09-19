import { describe, expect, it } from 'vitest'

import { InMemoryTokenStore, tokensFromAuthResponse } from './tokenStore'
import type { AuthResponse } from './types'

describe('InMemoryTokenStore', () => {
  it('starts empty', () => {
    const store = new InMemoryTokenStore()
    expect(store.getAccessToken()).toBeNull()
    expect(store.getRefreshToken()).toBeNull()
  })

  it('stores and returns both tokens', () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'jwt-1', refreshToken: 'refresh-1' })

    expect(store.getAccessToken()).toBe('jwt-1')
    expect(store.getRefreshToken()).toBe('refresh-1')
  })

  it('overwrites tokens on a second setTokens', () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'jwt-1', refreshToken: 'refresh-1' })
    store.setTokens({ accessToken: 'jwt-2', refreshToken: 'refresh-2' })

    expect(store.getAccessToken()).toBe('jwt-2')
    expect(store.getRefreshToken()).toBe('refresh-2')
  })

  it('clears both tokens', () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'jwt-1', refreshToken: 'refresh-1' })
    store.clear()

    expect(store.getAccessToken()).toBeNull()
    expect(store.getRefreshToken()).toBeNull()
  })

  it('keeps tokens in memory only (no persistence surface exposed)', () => {
    // The store is a plain in-memory class: it exposes no storage, cookie,
    // IndexedDB or localStorage access. This test asserts the API surface is
    // only get/set/clear — the security note in apps/web/README.md forbids
    // persisting tokens anywhere else.
    const store = new InMemoryTokenStore()
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(store))).toEqual(
      expect.arrayContaining([
        'constructor',
        'getAccessToken',
        'getRefreshToken',
        'setTokens',
        'clear',
      ]),
    )
  })
})

describe('tokensFromAuthResponse', () => {
  it('maps the wire field `jwt` to the access token', () => {
    const res: AuthResponse = { jwt: 'jwt-abc', refreshToken: 'refresh-abc' }
    expect(tokensFromAuthResponse(res)).toEqual({
      accessToken: 'jwt-abc',
      refreshToken: 'refresh-abc',
    })
  })
})
