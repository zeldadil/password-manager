import type { AuthResponse } from './types';

/** In-memory access + refresh token pair. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Storage abstraction the API client reads/writes for JWT access + refresh
 * tokens. Swappable so the UI can drive session lifecycle (login/logout/lock)
 * without the client knowing where tokens live.
 */
export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: AuthTokens): void;
  clear(): void;
}

/** Map the wire auth response (`jwt` field) to the internal token pair. */
export function tokensFromAuthResponse(res: AuthResponse): AuthTokens {
  return { accessToken: res.jwt, refreshToken: res.refreshToken };
}

/**
 * In-memory token store.
 *
 * SECURITY: access + refresh tokens live ONLY in JS heap memory for the
 * lifetime of the session. They are never written to `localStorage`,
 * `sessionStorage`, `IndexedDB`, cookies, logs, or telemetry (apps/web/README.md
 * security note, ADR-002 §4.2, SEC-001 AR-1/AR-2). The UI must call `clear()`
 * on lock/navigation.
 */
export class InMemoryTokenStore implements TokenStore {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  setTokens(tokens: AuthTokens): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
  }

  clear(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }
}
