/** @fileoverview JWT signing and verification utilities.

 * HMAC-SHA256 (HS256) — symmetric signing using Node.js built-in `crypto`.
 * No external JWT library needed; the JWT wire format is trivial and
 * auditable in ~50 lines.
 *
 * AR-1: Only Node.js built-in `crypto` — no home-grown crypto primitives.
 * AR-2: No real secrets in this file — the shared secret is injected at
 *        runtime via config; test fixtures are synthetic.
 * AR-3: Positive + negative tests in __tests__/jwt.test.ts.
 */

import { createHmac, randomBytes } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM = 'HS256';
const HEADER = Buffer.from(JSON.stringify({ alg: ALGORITHM, typ: 'JWT' })).toString('base64url');

/** Default access-token lifetime (15 minutes per BE-002b AC2). */
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Default refresh-token lifetime (30 days per BE-002b AC2). */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;    // user ID
  aud: string;    // intended audience (e.g. 'pm-api')
  exp: number;    // expiry Unix timestamp (seconds)
  iat: number;    // issued-at Unix timestamp (seconds)
  jti: string;    // unique token ID (for revocation/rotation)
}

export interface SignedJwt {
  token: string;
  payload: JwtPayload;
  expiresAt: Date;
}

// ─── Signing ──────────────────────────────────────────────────────────────────

/** Sign a payload into a JWT using the shared HMAC secret. */
export function signJwt(
  payload: JwtPayload,
  secret: string,
): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${HEADER}.${payloadB64}`)
    .digest('base64url');
  return `${HEADER}.${payloadB64}.${signature}`;
}

/** Build a signed access token for the given user. */
export function signAccessToken(
  userId: string,
  secret: string,
  ttlMs: number = ACCESS_TOKEN_TTL_MS,
): SignedJwt {
  const now = Date.now();
  const jti = randomBytes(12).toString('hex');
  const payload: JwtPayload = {
    sub: userId,
    aud: 'pm-api',
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + ttlMs) / 1000),
    jti,
  };
  return {
    token: signJwt(payload, secret),
    payload,
    expiresAt: new Date(now + ttlMs),
  };
}

/** Build a signed refresh token for the given user. */
export function signRefreshToken(
  userId: string,
  secret: string,
  ttlMs: number = REFRESH_TOKEN_TTL_MS,
): SignedJwt {
  const now = Date.now();
  const jti = randomBytes(16).toString('hex');
  const payload: JwtPayload = {
    sub: userId,
    aud: 'pm-api',
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + ttlMs) / 1000),
    jti,
  };
  return {
    token: signJwt(payload, secret),
    payload,
    expiresAt: new Date(now + ttlMs),
  };
}

// ─── Verification ─────────────────────────────────────────────────────────────

const REQUIRED_AUD = 'pm-api';

/**
 * Verify and decode a JWT.
 * Returns the decoded payload if valid; throws on any failure.
 */
export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('jwt: malformed token — expected 3 dot-separated parts');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature
  const expectedSig = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const actualSig = signatureB64;
  if (actualSig !== expectedSig) {
    throw new Error('jwt: invalid signature');
  }

  // Decode payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as JwtPayload;
  } catch {
    throw new Error('jwt: malformed payload');
  }

  // Validate required claims
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('jwt: missing or invalid "sub" claim');
  }
  if (payload.aud !== REQUIRED_AUD) {
    throw new Error('jwt: invalid audience');
  }
  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
    throw new Error('jwt: missing exp/iat claims');
  }

  // Check expiry
  const now = Date.now();
  if (now > payload.exp * 1000) {
    throw new Error('jwt: token expired');
  }

  return payload;
}

/** Parse a JWT without verifying — only for extracting claims from a token
 * we already trust (e.g. a refresh token we just issued). */
export function decodeJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('jwt: malformed token');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as JwtPayload;
}
