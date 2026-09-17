import { ApiError, apiErrorFromEnvelope, toApiError } from './errors';
import { tokensFromAuthResponse, type TokenStore } from './tokenStore';
import type {
  ApiEnvelope,
  AuthResponse,
  EnvelopeErrorBody,
  EnvelopeHeader,
  RefreshRequest,
} from './types';

type FetchLike = typeof fetch;

export interface ApiClientOptions {
  /** Base API URL (e.g. `http://localhost:3000/api/v1`). Trailing slash stripped. */
  baseUrl: string;
  /** Token store the client reads/writes for JWT + refresh tokens. */
  tokenStore: TokenStore;
  /** Injectable fetch (defaults to global `fetch`) — enables unit tests without network. */
  fetchImpl?: FetchLike;
  /** Paths that must never carry the `Authorization` header (login/refresh). */
  publicPaths?: string[];
  /** Called when the session is unrecoverable (refresh failed) — e.g. redirect to unlock. */
  onUnauthorized?: () => void;
}

const DEFAULT_PUBLIC_PATHS = ['/auth/login', '/auth/refresh'];

function isEnvelopeLike(value: unknown): value is { header: unknown; body: unknown } {
  return typeof value === 'object' && value !== null && 'header' in value;
}

/**
 * Typed fetch wrapper for the Secure Password Manager API.
 *
 * Responsibilities (FE-001f):
 *  - envelope parsing — unwrap `{ header, body }` and return the typed `body`;
 *  - JWT interceptor — inject `Authorization: Bearer <accessToken>`;
 *  - refresh handling — transparently rotate the access token on 401, single-flight;
 *  - error normalization — every failure is an {@link ApiError}.
 *
 * Tokens are held in-memory only via the injected {@link TokenStore}; nothing is
 * ever persisted or logged (SEC-001).
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: FetchLike;
  private readonly publicPaths: string[];
  private readonly onUnauthorized: (() => void) | undefined;

  /** In-flight refresh promise — collapses concurrent 401s into one /auth/refresh. */
  private refreshPromise: Promise<AuthResponse> | null = null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tokenStore = options.tokenStore;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.publicPaths = options.publicPaths ?? DEFAULT_PUBLIC_PATHS;
    this.onUnauthorized = options.onUnauthorized;
  }

  /** GET `path`, returning the typed envelope `body`. */
  get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  /** POST `path` with a JSON `body`, returning the typed envelope `body`. */
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** PATCH `path` with a JSON `body`, returning the typed envelope `body`. */
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** DELETE `path`, returning the typed envelope `body`. */
  delete<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'DELETE' });
  }

  /**
   * Core typed fetch. Parses the envelope, injects the JWT, and transparently
   * refreshes the access token on 401 (retrying the request exactly once).
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const attempt = async (): Promise<T> => {
      const response = await this.fetchImpl(this.buildUrl(path), this.buildInit(path, init));
      return this.parseResponse<T>(response);
    };

    try {
      return await attempt();
    } catch (error) {
      const apiError = error instanceof ApiError ? error : toApiError(error);
      if (
        apiError.isUnauthorized &&
        !this.isPublicPath(path) &&
        this.tokenStore.getRefreshToken() !== null
      ) {
        await this.refresh();
        return attempt();
      }
      throw apiError;
    }
  }

  /**
   * Rotate the access + refresh token via `POST /auth/refresh`.
   * Single-flight: concurrent callers share one refresh request.
   * On failure the token store is cleared and `onUnauthorized` fires.
   */
  async refresh(): Promise<AuthResponse> {
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }

    const refreshToken = this.tokenStore.getRefreshToken();
    if (refreshToken === null) {
      throw new ApiError({
        message: 'No refresh token available',
        kind: 'unauthorized',
        httpStatus: 401,
      });
    }

    this.refreshPromise = this.doRefresh(refreshToken).finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async doRefresh(refreshToken: string): Promise<AuthResponse> {
    const body: RefreshRequest = { refreshToken };

    try {
      const response = await this.fetchImpl(this.buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw await this.parseErrorResponse(response);
      }

      const auth = await this.readRefreshBody(response);
      this.tokenStore.setTokens(tokensFromAuthResponse(auth));
      return auth;
    } catch (error) {
      this.failSession();
      if (error instanceof ApiError) {
        throw error;
      }
      throw toApiError(error, 'Token refresh failed');
    }
  }

  /** Clear the session and notify the UI that re-authentication is required. */
  private failSession(): void {
    this.tokenStore.clear();
    this.onUnauthorized?.();
  }

  private buildUrl(path: string): string {
    return this.baseUrl + (path.startsWith('/') ? path : `/${path}`);
  }

  private buildInit(path: string, init: RequestInit): RequestInit {
    const headers = new Headers(init.headers);

    if (!this.isPublicPath(path)) {
      const token = this.tokenStore.getAccessToken();
      if (token !== null) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return { ...init, headers };
  }

  private isPublicPath(path: string): boolean {
    return this.publicPaths.includes(path);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw await this.parseErrorResponse(response);
    }

    const envelope = await this.readEnvelope<T>(response);
    if (envelope === null) {
      return undefined as T;
    }

    const header = envelope.header;
    const isError = header.status === 'error' || header.code >= 400;

    if (isError) {
      throw apiErrorFromEnvelope(response.status, header, envelope.body as EnvelopeErrorBody);
    }

    return envelope.body;
  }

  /** Parse a non-2xx response into an {@link ApiError}, best-effort. */
  private async parseErrorResponse(response: Response): Promise<ApiError> {
    const payload = await this.tryReadJson(response);
    if (isEnvelopeLike(payload)) {
      return apiErrorFromEnvelope(
        response.status,
        payload.header as EnvelopeHeader,
        payload.body as EnvelopeErrorBody,
      );
    }
    return new ApiError({
      message: `Request failed with status ${response.status}`,
      kind: 'http',
      httpStatus: response.status,
    });
  }

  private async readEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
    const payload = await this.tryReadJson(response);

    // 2xx with empty / non-JSON body → nothing to unwrap.
    if (payload === null) {
      return null;
    }

    if (!isEnvelopeLike(payload)) {
      throw new ApiError({
        message: 'Malformed response envelope',
        kind: 'envelope',
        httpStatus: response.status,
      });
    }

    return payload as ApiEnvelope<T>;
  }

  private async readRefreshBody(response: Response): Promise<AuthResponse> {
    const envelope = await this.readEnvelope<AuthResponse>(response);
    const auth = envelope?.body;

    if (
      auth === null ||
      typeof auth !== 'object' ||
      typeof (auth as AuthResponse).jwt !== 'string' ||
      typeof (auth as AuthResponse).refreshToken !== 'string'
    ) {
      throw new ApiError({ message: 'Malformed refresh response', kind: 'envelope' });
    }

    return auth as AuthResponse;
  }

  private async tryReadJson(response: Response): Promise<unknown | null> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}
