/** @fileoverview Lock endpoint — POST /auth/lock + GET /auth/status (BE-002c).

 * POST /auth/lock: accepts a valid Bearer access token, looks up the
 * corresponding server-side session, and:
 *   1. Marks the bound refresh token as revoked (revokedAt = now).
 *   2. Soft-deletes the session (deletedAt = now).
 * The access token JWT itself is stateless (HS256, 15-min TTL) and not
 * revocable server-side, so the client MUST discard it after a successful
 * lock response.
 *
 * GET /auth/status: returns vault "unlocked" state (with session id + expiry)
 * when a valid non-expired, non-revoked session exists for the authenticated
 * user; returns 401 "vault is locked" otherwise.
 *
 * AR-2: No real secrets in logs — JWT secret never logged.
 * AR-3: Positive + negative tests in tests/auth/lock.test.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { sessions, refreshTokens } from '../schema';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { config } from '../config';
import { verifyJwtAuth, type JwtAuthPayload } from './jwt';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LockResponseBody {
  status: 'locked';
}

export interface StatusResponseBody {
  status: 'unlocked';
  sessionId: string;
  expiresAt: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function findActiveSession(userId: string) {
  const rows = await db.query.sessions.findMany({
    where: and(
      eq(sessions.userId, userId),
      isNull(sessions.deletedAt),
    ),
    orderBy: (s, { desc }) => [desc(s.lastUsedAt)],
    limit: 1,
  });
  return rows[0] ?? null;
}

function sessionIsValid(session: typeof sessions.$inferSelect): boolean {
  const now = new Date();
  if (session.expiresAt < now) return false;
  if (session.deletedAt !== null) return false;
  return true;
}

function authMissing(reply: FastifyReply) {
  return reply.code(401).send({
    error: 'Unauthorized',
    message: 'Missing or malformed Authorization header',
  });
}

function authInvalid(reply: FastifyReply) {
  return reply.code(401).send({
    error: 'Unauthorized',
    message: 'Invalid or expired access token',
  });
}

// ─── Plugin ────────────────────────────────────────────────────────────────────

export function lockPlugin(server: FastifyInstance): void {
  // ── POST /auth/lock ─────────────────────────────────────────────────────────

  server.post<{ Path: '/auth/lock'; Reply: LockResponseBody }>(
    '/auth/lock',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string', enum: ['locked'] } },
            required: ['status'],
          },
          401: {
            description: 'Unauthorized — missing, invalid, or expired access token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let auth: JwtAuthPayload;
      try {
        auth = verifyJwtAuth(request);
      } catch (err: unknown) {
        const code = err instanceof Error ? err.message : 'AUTH_INVALID_TOKEN';
        if (code === 'AUTH_MISSING') return authMissing(reply);
        return authInvalid(reply);
      }

      const userId = auth.userId;

      const session = await findActiveSession(userId);
      if (!session || !sessionIsValid(session)) {
        // No valid session — vault already locked. Idempotent 200.
        return reply.code(200).send({ status: 'locked' });
      }

      const now = new Date();

      // Revoke the refresh token bound to this session.
      if (session.refreshTokenHash) {
        await db
          .update(refreshTokens)
          .set({ revokedAt: now, updatedAt: now })
          .where(eq(refreshTokens.tokenHash, session.refreshTokenHash));
      }

      // Soft-delete the session.
      await db
        .update(sessions)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(sessions.id, session.id));

      return reply.code(200).send({ status: 'locked' });
    },
  );

  // ── GET /auth/status ────────────────────────────────────────────────────────

  server.get<{ Path: '/auth/status'; Reply: StatusResponseBody }>(
    '/auth/status',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['unlocked'] },
              sessionId: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
            required: ['status', 'sessionId', 'expiresAt'],
          },
          401: {
            description: 'Unauthorized — missing, invalid, or expired access token, or no active session',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let auth: JwtAuthPayload;
      try {
        auth = verifyJwtAuth(request);
      } catch (err: unknown) {
        const code = err instanceof Error ? err.message : 'AUTH_INVALID_TOKEN';
        if (code === 'AUTH_MISSING') return authMissing(reply);
        return authInvalid(reply);
      }

      const userId = auth.userId;

      const session = await findActiveSession(userId);
      if (!session || !sessionIsValid(session)) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'No active session — vault is locked',
        });
      }

      // Auto-lock check: if the session has been inactive beyond the timeout,
      // treat it as locked even though the server-side record still exists.
      if (session.lastUsedAt) {
        const now = new Date();
        const inactivityMs = now.getTime() - session.lastUsedAt.getTime();
        if (inactivityMs > config.autoLockTimeoutMs) {
          return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Session expired due to inactivity — vault is locked',
          });
        }
      }

      return reply.code(200).send({
        status: 'unlocked',
        sessionId: session.id,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  );
}
