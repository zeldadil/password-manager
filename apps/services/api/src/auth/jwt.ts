/** @fileoverview JWT signing/verification + auth guard using Node.js built-in crypto (HS256).
 *
 * Thin wrapper — no third-party JWT library. Uses HMAC-SHA256.
 * Appropriate for a self-hosted password manager where the signing secret
 * never leaves the server process.
 *
 * AR-1: Node.js built-in crypto only — no additional dependency.
 * AR-2: Signing secret is never logged or returned to client.
 * AR-3: Tokens carry only non-secret claims (userId, exp, iat, type).
 */

import type { FastifyRequest } from 'fastify';
import { createHmac, randomBytes } from 'node:crypto';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function b64urlNoPad(str: string): string {
  return str.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// ─── Access token (JWT HS256) ──────────────────────────────────────────────────

export interface JwtClaims {
  userId: string;
  sessionId: string;
  exp: number;
  iat: number;
  type: 'access';
}

export function signAccessToken(userId: string, secret: string, expiresInSec: number, sessionId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlNoPad(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64'));
  const payload = b64urlNoPad(
    Buffer.from(JSON.stringify({ userId, sessionId, iat: now, exp: now + expiresInSec, type: 'access' })).toString(
      'base64',
    ),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(createHmac('sha256', secret).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

export interface DecodedAccessToken {
  userId: string;
  sessionId: string;
  exp: number;
  iat: number;
  type: 'access';
}

export function verifyAccessToken(token: string, secret: string): DecodedAccessToken {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('AUTH_INVALID_TOKEN');

  const [headerB64, payloadB64, providedSig] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = b64url(createHmac('sha256', secret).update(signingInput).digest());
  if (!sigEquals(providedSig, expectedSig)) {
    throw new Error('AUTH_INVALID_TOKEN');
  }

  const payloadBytes = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadBytes.toString('utf-8'));
  } catch {
    throw new Error('AUTH_INVALID_TOKEN');
  }

  if (payload.type !== 'access') throw new Error('AUTH_INVALID_TOKEN');
  if (typeof payload.userId !== 'string' || !payload.userId) throw new Error('AUTH_INVALID_TOKEN');
  if (typeof payload.sessionId !== 'string' || !payload.sessionId) throw new Error('AUTH_INVALID_TOKEN');
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('AUTH_INVALID_TOKEN');
  }

  return {
    userId: payload.userId as string,
    sessionId: payload.sessionId as string,
    exp: payload.exp as number,
    iat: (payload.iat as number) ?? 0,
    type: 'access',
  };
}

/** Constant-time comparison to avoid timing attacks on signature check. */
function sigEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Refresh token (opaque random, hashed in DB for reuse detection) ───────────

export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHmac('sha256', 'refresh-token-hmac-salt').update(token).digest('hex');
}

// ─── Auth guard (BE-002c) ──────────────────────────────────────────────────────

export interface JwtAuthPayload {
  userId: string;
  sessionId: string;
}

const DEV_JWT_SECRET_FALLBACK = 'dev-jwt-secret-change-in-production';

/**
 * Resolve the JWT signing/verification secret from JWT_SECRET.
 *
 * Fails closed in production: a misconfigured prod deployment that forgot
 * to set JWT_SECRET must not silently sign tokens with a secret string
 * that's sitting in public source control. Outside production (dev/test),
 * falls back to a fixed dev secret for convenience.
 *
 * The one function all sign/verify call sites use, so there's a single
 * source of truth — register.ts, unlock.ts, refresh.ts and this module's
 * own verifyJwtAuth all resolve to the same secret for the same env.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return DEV_JWT_SECRET_FALLBACK;
}

/**
 * Extract and verify the Bearer access token from the Authorization header.
 *
 * Callers (lock, future resource endpoints) use this to establish *who* is
 * calling. The caller is responsible for what "authenticated" means in its
 * domain — e.g. lock checks the session exists; a resource endpoint checks
 * ownership/permissions.
 */
export function verifyJwtAuth(request: FastifyRequest): JwtAuthPayload {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new Error('AUTH_MISSING');
  }
  const token = header.slice(7);
  if (!token) {
    throw new Error('AUTH_MISSING');
  }
  const decoded = verifyAccessToken(token, getJwtSecret());
  return { userId: decoded.userId, sessionId: decoded.sessionId };
}
