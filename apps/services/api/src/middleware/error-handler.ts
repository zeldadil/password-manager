/**
 * BE-001f: Global error handler.
 *
 * Every error that reaches the client — a thrown handler error, Fastify's
 * routing layer (404), the validation layer (400), or the catch-all (5xx) —
 * is mapped to an ADR-004 envelope:
 *
 *   { header: { id, status:'error', servertime, action, code, message },
 *     body:   { errors: [{ code, field, message }], documentationUrl? } }
 *
 * Security (SEC-001 Absolute Rules AR-2 / AR-4; Vector 2 & 4 — information
 * disclosure + secret logging):
 *
 *  - Stack traces are NEVER sent to the client. In development they are
 *    logged server-side (redacted); in production only a sanitized, bounded
 *    log line is emitted — never the stack, never raw error.message.
 *  - `error.message` and Ajv validation messages are never echoed raw — they
 *    pass through `redactSecrets`, so a value that happens to look like a
 *    token (e.g. a pasted bot token in a validation error) is never reflected.
 *  - The catch-all maps every unrecognized error to 500 "An internal server
 *    error occurred." — no internals, file paths, SQL, or secrets leak.
 *
 * Integration with BE-001d: the envelope produced here is a *complete*
 * ErrorEnvelope (isEnvelope === true), so the BE-001d preSerialization hook
 * passes it through untouched — no double-wrapping (see envelope.ts).
 */
import type { FastifyBaseLogger, FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config';
import {
  type ErrorDetail,
  type ErrorEnvelope,
  type ErrorEnvelopeBody,
  buildEnvelopeHeader,
  deriveAction,
} from './envelope';

// ── Secret redaction (SEC-001 AR-2, Vector 4) ──────────────────────────
// Defense in depth. The happy path never echoes error.message to the client;
// these patterns also guard server-side logs and the (echoed) Ajv validation
// messages. Nothing that resembles a credential should survive into a
// response or a log line.
const SECRET_PATTERNS: RegExp[] = [
  // Telegram bot tokens / colon-separated API keys: 123456789:AA...
  /\d{6,}:[A-Za-z0-9_-]{20,}/g,
  // Bearer / OAuth tokens: keep the scheme label, redact the token value only
  /(?<=Bearer\s+)[A-Za-z0-9._-]{20,}/gi,
  // key/secret/password/token/salt/iv/tag <op> <8+ non-space chars>
  /(?:key|secret|password|token|salt|iv|tag)\s*(?:=|:|\s)\s*\S{8,}/gi,
];

/** Redact known secret formats from `text`. Non-strings become `''`. */
export function redactSecrets(text: unknown): string {
  if (typeof text !== 'string') return '';
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '<REDACTED>'), text);
}

// ── Status → message / machine-code mapping ──────────────────────────────
const STATUS_MESSAGES: Record<number, string> = {
  400: 'The request could not be processed.',
  401: 'Authentication is required.',
  403: 'You do not have permission to access this resource.',
  404: 'The requested resource could not be found.',
  409: 'The request conflicts with the current state of the resource.',
  429: 'Too many requests. Please try again later.',
  500: 'An internal server error occurred.',
  503: 'The service is temporarily unavailable.',
};

const ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'UNAVAILABLE',
};

function friendlyMessage(code: number): string {
  return STATUS_MESSAGES[code] ?? (code >= 500 ? STATUS_MESSAGES[500]! : 'An error occurred while processing your request.');
}
function machineCode(code: number): string {
  return ERROR_CODES[code] ?? (code >= 500 ? ERROR_CODES[500]! : ERROR_CODES[400]!);
}

// Minimal, dependency-free view of an Ajv/Fastify validation item.
interface ValidationItem {
  message?: unknown;
  instancePath?: unknown;
  params?: { missingProperty?: unknown; path?: unknown };
}

/** Build the `errors` array for Fastify/Ajv validation failures (HTTP 400). */
function validationDetails(validation: unknown): ErrorDetail[] {
  if (!Array.isArray(validation)) return [];
  return validation.map((v) => {
    const item = (v ?? {}) as ValidationItem;
    let field: string;
    if (typeof item.instancePath === 'string' && item.instancePath) {
      field = item.instancePath;
    } else if (typeof item.params?.missingProperty === 'string') {
      field = `missing:${item.params.missingProperty}`;
    } else if (item.params?.path !== undefined) {
      field = String(item.params.path);
    } else {
      field = ':global';
    }
    const rawMessage = typeof item.message === 'string' ? item.message : 'Invalid value';
    const message = redactSecrets(rawMessage) || 'Invalid value';
    const code =
      typeof item.message === 'string' && /required|missing|must have/i.test(item.message)
        ? 'REQUIRED'
        : 'VALIDATION_ERROR';
    return { code, field, message };
  });
}

/** FastifyError that may carry an Ajv `validation` array. */
type ValidatableError = FastifyError & { validation?: unknown };

/**
 * Pure mapping: a Fastify error → an ADR-004 error envelope.
 *
 * No I/O, no Fastify reply/serialize internals — safe to unit-test.
 * Never embeds `error.stack`, `error.cause`, or raw `error.message`.
 */
export function buildErrorEnvelope(error: FastifyError, request: FastifyRequest): ErrorEnvelope {
  // Not-found errors don't correspond to a real operation, so normalize the
  // action to "NotFound" instead of a URL-derived name like "GetDoes-not-exist".
  const action = error.code === 'FST_ERR_NOT_FOUND' ? 'NotFound' : deriveAction(request);
  const code = error.statusCode ?? 500;

  let errors: ErrorDetail[];
  const validatable = error as ValidatableError;
  if (code === 400 && Array.isArray(validatable.validation)) {
    errors = validationDetails(validatable.validation);
    if (errors.length === 0) {
      errors = [{ code: ERROR_CODES[400]!, field: ':global', message: friendlyMessage(400) }];
    }
  } else {
    errors = [{ code: machineCode(code), field: ':global', message: friendlyMessage(code) }];
  }

  const body: ErrorEnvelopeBody = { errors };
  const header = buildEnvelopeHeader({
    code,
    status: 'error',
    action,
    message: friendlyMessage(code),
  });
  return { header, body };
}

// ── Fastify error handler ───────────────────────────────────────────────
export interface ErrorHandlerOptions {
  /** Server logger; if omitted, logging is skipped (e.g. in unit tests). */
  log?: FastifyBaseLogger;
  /** Force an environment for testing. Defaults to `config.nodeEnv`. */
  nodeEnv?: string;
}

/**
 * Build the global Fastify error handler. Install once at the server ROOT
 * (createServer) so every route plugin and infra endpoint inherits it.
 *
 * The returned handler logs (redacted) then emits a single ADR-004 envelope
 * reply. It is the single code path for *every* error, including 404s raised
 * by `notFoundHandler` below.
 */
export function createErrorHandler(opts: ErrorHandlerOptions = {}): (
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) => void {
  const log = opts.log;
  const nodeEnv = opts.nodeEnv ?? config.nodeEnv;

  return function errorHandler(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    // ── Server-side logging (SEC-001 Vector 4: redact + bound) ────
    // Dev: log redacted message + redacted stack (server-side only).
    // Prod: one redacted, bounded warning line — no stack, no raw message.
    const safeMessage = redactSecrets(error.message);
    if (log) {
      if (nodeEnv === 'development') {
        log.error(
          { statusCode: error.statusCode, stack: redactSecrets(error.stack) },
          safeMessage,
        );
      } else {
        log.warn({ statusCode: error.statusCode }, safeMessage);
      }
    }

    // ── Client response ────────────────────────────────────────────
    // `buildErrorEnvelope` returns a complete ErrorEnvelope (isEnvelope
    // === true), so BE-001d's preSerialization hook passes it through —
    // even on /api/v1 — with no double-wrapping.
    const envelope = buildErrorEnvelope(error, request);
    reply.code(envelope.header.code).send(envelope);
  };
}

/**
 * Root-scope not-found handler.
 *
 * Fastify does NOT route unmatched 404s through `setErrorHandler`: a request
 * to an unknown path hits the `onNotFound` flow and returns Fastify's default
 * `{"statusCode":404,"error":"Not Found","message":"..."}` body — NOT the
 * global error handler. Without this handler, 404s (on `/api/v1` and on infra
 * paths like `/health`, `/openapi.json`) would return a *raw* Fastify body,
 * breaking the "consistent error envelope" invariant.
 *
 * This handler throws a synthetic `FST_ERR_NOT_FOUND` FastifyError. Fastify
 * catches it and routes it through `setErrorHandler` → `buildErrorEnvelope`,
 * so 404s are enveloped identically to every other error (no stack leak,
 * redacted, :global field). Verified: throwing from `setNotFoundHandler`
 * reaches the error handler in Fastify v5.
 *
 * Installed at the ROOT scope in `createServer` so every plugin inherits it.
 */
export function notFoundHandler(_request: FastifyRequest, _reply: FastifyReply): never {
  const error = new Error('Not Found') as FastifyError;
  error.statusCode = 404;
  error.code = 'FST_ERR_NOT_FOUND';
  throw error;
}
