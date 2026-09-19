/**
 * ADR-004 Envelope contract — shared TypeScript types.
 *
 * Every response on the versioned `/api/v1` API is wrapped in:
 *
 *   { header: { id, status, servertime, action, message, url, code }, body }
 *
 * This module is the single source of truth for the envelope shape. Both the
 * API server (apps/services/api) and the web client (apps/web → FE-001f typed
 * fetch wrapper) import these types from packages/shared, per ADR-002 §2.3
 * ("packages/shared — Shared types, message contracts, validation helpers").
 *
 * PASSBOLT-INSPIRED (ADR-001 §8, adapted): the { header, body } envelope
 * structure. ORIGINAL: field naming (id/status/servertime/action/message/url/code)
 * and the ErrorDetail shape, adapted from Passbolt's conventions to our
 * symmetric-AEAD model.
 *
 * Security (SEC-001 AR-2): these types carry no secret values — they are
 * transport metadata + an opaque body handle. Ciphertext never flows through
 * the envelope header.
 */

/**
 * Human-readable response status.
 *
 *  - `success` — the operation completed as expected (HTTP 2xx).
 *  - `error`   — the operation failed (HTTP 4xx/5xx); `body` is an
 *    `ErrorEnvelopeBody`.
 *  - `warning` — the operation completed but something needs attention.
 */
export type EnvelopeStatus = 'success' | 'error' | 'warning';

/**
 * Transport metadata returned with every `/api/v1` response.
 *
 * Mirrors the `EnvelopeHeader` schema in ADR-004-api-contract.yaml.
 */
export interface EnvelopeHeader {
  /** Unique response ID (UUID v4) — useful for distributed tracing. */
  id: string;
  /** Human-readable status. */
  status: EnvelopeStatus;
  /** Server timestamp (UTC, ISO-8601) when the response was generated. */
  servertime: string;
  /**
   * Operation that produced this response (e.g. `ListResources`,
   * `CreateResource`, `Authenticate`). Mirrors the OpenAPI `operationId`.
   */
  action: string;
  /** Human-readable message — empty on success; descriptive on error/warning. */
  message: string;
  /** Optional URL related to the response (e.g. canonical resource URL). */
  url?: string;
  /** Machine-readable status code mirroring the HTTP status line. */
  code: number;
}

/**
 * Machine-readable, field-level error detail (ADR-004 `ErrorDetail`).
 */
export interface ErrorDetail {
  /** Machine-readable error code (e.g. `VALIDATION_ERROR`, `NOT_FOUND`). */
  code: string;
  /**
   * The field or parameter that caused the error.
   * `":global"` for errors not attributable to a single field.
   */
  field: string;
  /** Human-readable description (no sensitive detail). */
  message: string;
}

/** `body` block of an error envelope. */
export interface ErrorEnvelopeBody {
  errors: ErrorDetail[];
  /** Optional link to API documentation for this error class. */
  documentationUrl?: string;
}

/** A successful response: `{ header, body }`. */
export interface SuccessEnvelope<T = unknown> {
  header: EnvelopeHeader;
  body: T;
}

/** An error response: `{ header, body: { errors, documentationUrl? } }`. */
export interface ErrorEnvelope {
  header: EnvelopeHeader;
  body: ErrorEnvelopeBody;
}

/** Either a success or error envelope. */
export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;
