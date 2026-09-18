/**
 * API contract types for the Secure Password Manager Web UI.
 *
 * Mirrors the envelope convention in ADR-004 (OpenAPI 3.1): every response body
 * is wrapped in a `{ header, body }` envelope. `header` carries transport
 * metadata; `body` carries the entity payload. PASSBOLT-INSPIRED (ADR-001 §8),
 * adapted to this project's own naming and shape.
 */

export type EnvelopeStatus = 'success' | 'error' | 'warning';

export interface EnvelopeHeader {
  /** Unique response ID (UUID v4) — used for tracing. */
  id: string;
  /** Human-readable status: success | error | warning. */
  status: EnvelopeStatus;
  /** Server timestamp (UTC) when the response was generated. */
  servertime: string;
  /** Operation that produced this response (e.g. ListResources). */
  action: string;
  /** Human-readable message. Empty on success; descriptive on error. */
  message?: string;
  /** Optional related URL. */
  url?: string;
  /** Machine-readable status code; mirrors the HTTP status line. */
  code: number;
}

/** Success envelope — `body` carries the typed payload. */
export interface ApiEnvelope<T = unknown> {
  header: EnvelopeHeader;
  body: T;
}

export interface ErrorDetail {
  /** Machine-readable error code (VALIDATION_ERROR, NOT_FOUND, FORBIDDEN, UNAUTHORIZED…). */
  code: string;
  /** Field/parameter that caused the error. */
  field: string;
  /** Human-readable description. */
  message: string;
}

/** Error envelope body — `errors` array + optional documentation link. */
export interface EnvelopeErrorBody {
  errors?: ErrorDetail[];
  documentationUrl?: string;
}

/**
 * Auth/session response (POST /auth/login, POST /auth/refresh).
 *
 * The field `jwt` matches ADR-002 §4.2 step 8 ("Return { jwt, refreshToken }").
 * The JWT access token is short-lived (≤15m); the refresh token is rotated on
 * each use (ADR-004 /auth/refresh; SEC-001).
 */
export interface AuthResponse {
  jwt: string;
  refreshToken: string;
}

/** Login request body (ADR-004 /auth/login). */
export interface LoginRequest {
  email: string;
  vaultKeyProof: string;
  mfaCode?: string;
}

/** Refresh request body (ADR-004 /auth/refresh). */
export interface RefreshRequest {
  refreshToken: string;
}
