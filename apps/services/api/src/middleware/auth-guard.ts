/** @fileoverview Shared active-session auth guard for `/api/v1` routes.
 *
 * Extracted from the session-validity + auto-lock checks already used by
 * GET /auth/status (BE-002c) — every `/api/v1` resource route (folders,
 * resources, tags, ...) needs the same check: a syntactically valid JWT is
 * not enough, the session it names must still exist, be unexpired, and not
 * have gone auto-lock-stale. This keeps that logic in one place instead of
 * re-implementing it per resource plugin.
 *
 * AR-2: No secrets in logs — only userId/sessionId (non-secret identifiers)
 * ever leave this module.
 */

import type { FastifyRequest } from 'fastify';
import { db } from '../db';
import { sessions, vaults } from '../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { config } from '../config';
import { verifyJwtAuth } from '../auth/jwt';
import { httpError } from './error-handler';

export interface ActiveSession {
  userId: string;
  sessionId: string;
}

function sessionIsValid(session: typeof sessions.$inferSelect): boolean {
  const now = new Date();
  if (session.expiresAt < now) return false;
  if (session.deletedAt !== null) return false;
  if (session.lastUsedAt) {
    const inactivityMs = now.getTime() - session.lastUsedAt.getTime();
    if (inactivityMs > config.autoLockTimeoutMs) return false;
  }
  return true;
}

/**
 * Verify the request's Bearer JWT and its bound session, returning the
 * authenticated user + session id. Throws a 401 `httpError` (never a raw
 * Error) on any failure — missing/malformed header, invalid/expired token,
 * missing/expired/revoked session, or an auto-locked (inactive) session.
 */
export async function requireActiveSession(request: FastifyRequest): Promise<ActiveSession> {
  let auth: { userId: string; sessionId: string };
  try {
    auth = verifyJwtAuth(request);
  } catch {
    throw httpError(401, 'Missing or invalid access token');
  }

  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, auth.sessionId), isNull(sessions.deletedAt)),
  });
  if (!session || !sessionIsValid(session)) {
    throw httpError(401, 'Session expired, revoked, or auto-locked');
  }

  return { userId: auth.userId, sessionId: auth.sessionId };
}

/**
 * The caller's own vault (ADR-003 §3.2: exactly one per user in MVP).
 * Shared by every vault-scoped `/api/v1` resource route (folders,
 * resources, tags, ...) — extracted from folders.ts (BE-003d) so it isn't
 * reimplemented per plugin.
 */
export async function requireOwnVault(userId: string) {
  const vault = await db.query.vaults.findFirst({
    where: and(eq(vaults.ownerId, userId), isNull(vaults.deletedAt)),
  });
  if (!vault) {
    throw httpError(404, 'No vault found for this user');
  }
  return vault;
}
