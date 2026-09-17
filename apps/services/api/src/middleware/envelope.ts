/**
 * BE-001d: Envelope response middleware.
 *
 * Wraps every `/api/v1` response in the ADR-004 envelope:
 *
 *   { header: { id, status, servertime, action, message, url, code }, body }
 *
 * Registered at the server root scope via `server.addHook` (see server.ts) so
 * the hook applies to every route, then guarded internally so only `/api/v1`
 * paths are enveloped — infra endpoints (`/health`, `/openapi.json`) are served
 * unwrapped (ADR-002 §3.2 / ADR-004 intro).
 *
 * Scope of BE-001d:
 *  - SUCCESS: wraps 2xx object payloads in a success envelope.
 *  - PASS-THROUGH: error/non-2xx payloads are left untouched; the global
 *    error handler (BE-001f, which depends on this task) builds error
 *    envelopes using the shared `buildEnvelopeHeader` helper, and those
 *    pre-built envelopes flow through `preSerialization` hitting the
 *    `isEnvelope` guard (no double-wrapping).
 *
 * NOTE: These types are the authoritative contract for the API server. A
 * mirror definition lives in packages/shared/src/envelope.ts for the web
 * client (FE-001f); keep them in sync until packages/shared is set up as a
 * built workspace package with cross-package type resolution.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

/* ───────────────────────── Envelope types ───────────────────────────── */

/** Human-readable response status (ADR-004 EnvelopeHeader.status). */
export type EnvelopeStatus = 'success' | 'error' | 'warning';

/** Transport metadata returned with every `/api/v1` response. */
export interface EnvelopeHeader {
  /** Unique response ID (UUID v4) — for distributed tracing / log correlation. */
  id: string;
  /** Human-readable status. */
  status: EnvelopeStatus;
  /** Server timestamp (UTC, ISO-8601) when the response was generated. */
  servertime: string;
  /** Operation that produced this response (e.g. "ListResources", "Authenticate"). */
  action: string;
  /** Human-readable message — empty on success, descriptive on error/warning. */
  message: string;
  /** Optional URL related to the response (e.g. canonical resource URL). */
  url?: string;
  /** Machine-readable status code mirroring the HTTP status line. */
  code: number;
}

/** `body` of a successful envelope — the original route payload. */
export interface SuccessEnvelope<T = unknown> {
  header: EnvelopeHeader;
  body: T;
}

/** Machine-readable field-level error detail (ADR-004 ErrorDetail). */
export interface ErrorDetail {
  /** Machine-readable error code (e.g. "VALIDATION_ERROR", "NOT_FOUND"). */
  code: string;
  /** Field or parameter that caused the error; ":global" for non-field errors. */
  field: string;
  /** Human-readable description. */
  message: string;
}

/** `body` of an error envelope. */
export interface ErrorEnvelopeBody {
  errors: ErrorDetail[];
  /** Optional link to documentation for the error. */
  documentationUrl?: string;
}

/** Complete error envelope (produced by BE-001f). */
export interface ErrorEnvelope {
  header: EnvelopeHeader;
  body: ErrorEnvelopeBody;
}

/** Union of all envelope shapes. */
export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

/* ───────────────────── Pure helpers (unit-testable) ──────────────────── */

/** Base path that receives envelope wrapping. */
export const API_V1_PREFIX = '/api/v1';

/**
 * Build a response envelope header.
 *
 * Pure / deterministic given inputs (only `id` and `servertime` are
 * non-deterministic). Safe to call from route handlers, hooks, and the
 * BE-001f error handler.
 */
export interface BuildHeaderInput {
  code: number;
  status: EnvelopeStatus;
  action: string;
  /** Empty string on success. Defaults to ''. */
  message?: string;
  /** Optional URL related to the response. */
  url?: string;
}

export function buildEnvelopeHeader(input: BuildHeaderInput): EnvelopeHeader {
  return {
    id: randomUUID(),
    status: input.status,
    servertime: new Date().toISOString(),
    action: input.action,
    message: input.message ?? '',
    url: input.url,
    code: input.code,
  };
}

/**
 * Derive the operation `action` name for a request.
 *
 * Priority:
 *  1. `routeOptions.config.operationId` — declared per-route to match the
 *     ADR-004 OpenAPI `operationId` (e.g. "ListResources").
 *  2. Fallback: verb + resource noun from the HTTP method and matched route
 *     pattern (e.g. GET `/api/v1/resources/:id` → "GetResources").
 *
 * Fastify v5 exposes the matched route pattern via `routeOptions.url`
 * (the `routerPath` alias was removed in v5).
 */
export function deriveAction(request: FastifyRequest): string {
  // 1. operationId declared on the route.
  const config = request.routeOptions?.config as { operationId?: unknown } | undefined;
  if (typeof config?.operationId === 'string') return config.operationId;

  // 2. Fallback — derive from method + path segments.
  const method = request.method;
  const pattern = request.routeOptions?.url ?? request.url;
  const path = pattern.split('?')[0];
  const segments = path.split('/').filter(Boolean);

  // Resource noun = last non-param, non-version segment.
  const nounSegments = segments.filter(
    (s) => !s.startsWith(':') && s !== 'api' && !/^v\d+$/.test(s),
  );
  const lastNoun = nounSegments[nounSegments.length - 1] ?? 'Request';
  const resource = lastNoun.charAt(0).toUpperCase() + lastNoun.slice(1);

  // Verb from HTTP method + whether the route targets a single item.
  const targetsItem = segments.some((s) => s.startsWith(':'));
  let verb: string;
  switch (method) {
    case 'GET':
      verb = targetsItem ? 'Get' : 'List';
      break;
    case 'POST':
      verb = 'Create';
      break;
    case 'PATCH':
      verb = 'Update';
      break;
    case 'PUT':
      verb = 'Replace';
      break;
    case 'DELETE':
      verb = 'Delete';
      break;
    default:
      verb = method;
  }
  return `${verb}${resource}`;
}

/**
 * Duck-type check: does `payload` already look like an envelope?
 *
 * Used to prevent double-wrapping when a route (or BE-001f's error handler)
 * returns a pre-built envelope.
 */
export function isEnvelope(payload: unknown): boolean {
  if (payload == null || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  return 'header' in obj && 'body' in obj;
}

/**
 * Wrap a payload in a success envelope.
 *
 * Pure helper — used by the preSerialization hook and available for tests
 * or routes that build envelopes manually.
 */
export function createSuccessEnvelope<T>(
  body: T,
  action: string,
  code: number,
  opts?: { message?: string; url?: string },
): SuccessEnvelope<T> {
  return {
    header: buildEnvelopeHeader({
      status: 'success',
      action,
      code,
      message: opts?.message,
      url: opts?.url,
    }),
    body,
  };
}

/* ───────────────────────── Fastify plugin ──────────────────────────── */

export interface EnvelopePluginOptions {
  /** Base path that receives envelope wrapping (default "/api/v1"). */
  basePath?: string;
}

/**
 * Envelope plugin.
 *
 * Adds a `preSerialization` hook that wraps 2xx object payloads under the
 * configured base path. Designed to be registered at the root scope
 * (`server.addHook` or `fastify.register(fp(...))`) so it covers all routes.
 *
 * Register with `server.addHook('preSerialization', envelopePreSerialization)`
 * in createServer for root-scope coverage across all route plugins.
 */
export const envelopePreSerialization = async (
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> => {
  // Only envelope versioned-API responses; leave infra endpoints unwrapped.
  const basePath = API_V1_PREFIX;
  const path = request.url.split('?')[0];
  if (!path.startsWith(basePath)) return payload;

  // Don't double-wrap an already-enveloped response (e.g. error envelope
  // built by BE-001f's error handler).
  if (isEnvelope(payload)) return payload;

  // Only wrap object payloads. Leave strings, null, 204s, streams, etc. as-is.
  if (typeof payload !== 'object' || payload === null) return payload;

  // Only wrap successful (2xx) responses. Error envelopes are the responsibility
  // of BE-001f (global error handler), which sends a complete envelope that
  // passes through the isEnvelope guard above.
  const statusCode = reply.statusCode;
  if (statusCode < 200 || statusCode >= 300) return payload;

  const action = deriveAction(request);
  return createSuccessEnvelope(payload, action, statusCode);
};

/**
 * Convenience plugin wrapper — register with `fastify.register(envelopePlugin)`
 * for scoped application, or use `server.addHook('preSerialization', ...)` for
 * root-scope coverage (recommended).
 */
export const envelopePlugin: FastifyPluginAsync<EnvelopePluginOptions> = async (
  fastify: FastifyInstance,
) => {
  fastify.addHook('preSerialization', envelopePreSerialization as never);
};
