import type { EnvelopeErrorBody, EnvelopeHeader, ErrorDetail } from './types';

export type ApiErrorKind = 'network' | 'http' | 'envelope' | 'unauthorized';

interface ApiErrorOptions {
  message: string;
  kind: ApiErrorKind;
  httpStatus?: number;
  action?: string | null;
  details?: ErrorDetail[];
  documentationUrl?: string;
  cause?: unknown;
}

/**
 * Normalized error thrown by every {@link ApiClient} method.
 *
 * All failures — network, HTTP, malformed envelope, failed refresh — are mapped
 * to this single type so callers never have to branch on raw fetch errors.
 * Error messages and details are generic on purpose: no token, secret, or
 * crypto material is ever embedded in an error (SEC-001 AR-2 / AR-4).
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly httpStatus: number;
  readonly action: string | null;
  readonly details: ErrorDetail[];
  readonly documentationUrl: string | undefined;

  constructor(options: ApiErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.httpStatus = options.httpStatus ?? 0;
    this.action = options.action ?? null;
    this.details = options.details ?? [];
    this.documentationUrl = options.documentationUrl;
  }

  /** True when the request was rejected as unauthorized (HTTP 401). */
  get isUnauthorized(): boolean {
    return this.httpStatus === 401 || this.kind === 'unauthorized';
  }

  /** First machine-readable error code (from the error envelope), if any. */
  get code(): string | null {
    return this.details[0]?.code ?? null;
  }
}

/**
 * Build an {@link ApiError} from an envelope error response.
 *
 * Message priority: `header.message` → first error detail message → generic
 * `Request failed with status <n>`. Field-level errors are preserved in
 * `details` for form/field rendering.
 */
export function apiErrorFromEnvelope(
  httpStatus: number,
  header: EnvelopeHeader | undefined,
  body: EnvelopeErrorBody | undefined,
): ApiError {
  const details = body?.errors ?? [];
  const message =
    header?.message || details[0]?.message || `Request failed with status ${httpStatus}`;

  return new ApiError({
    message,
    kind: 'http',
    httpStatus,
    action: header?.action ?? null,
    details,
    documentationUrl: body?.documentationUrl,
  });
}

/**
 * Coerce any thrown value into an {@link ApiError} (used for fetch rejections
 * and other non-HTTP failures). Existing `ApiError`s pass through unchanged.
 */
export function toApiError(cause: unknown, fallbackMessage = 'Network error'): ApiError {
  if (cause instanceof ApiError) {
    return cause;
  }
  if (cause instanceof Error) {
    return new ApiError({ message: cause.message, kind: 'network', cause });
  }
  return new ApiError({ message: fallbackMessage, kind: 'network', cause });
}
