/** @fileoverview Refresh endpoint — POST /auth/refresh (BE-002d).

 * Accepts a refresh token, validates it against the DB, enforces auto-lock
 * (configurable inactivity timeout, default 15 min), rotates the refresh
 * token, and returns a new short-lived access token.
 *
 * Auto-lock flow:
 *   1. Look up the session bound to the presented refresh token hash.
 *   2. If the session is missing, expired, revoked, or soft-deleted → 401.
 *   3. If (now - session.lastUsedAt) > config.autoLockTimeoutMs → 401
 *      "Session expired due to inactivity. Please re-unlock."
 *   4. Otherwise: revoke old refresh token, issue new refresh token,
 *      update session.lastUsedAt, sign + return new access token.
 *
 * Sleep/restart handling: the refresh token is stored hashed in the DB and
 * survives server restarts. The client holds the raw refresh token; after a
 * restart the client sends it to /auth/refresh to re-acquire an access token
 * without re-entering the master password — as long as the auto-lock timeout
 * has not elapsed.
 *
 * AR-2: No real secrets in logs — refresh tokens are never logged.
 * AR-3: Positive + negative tests in tests/auth/refresh.test.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { sessions, refreshTokens } from '../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { config } from '../config';
import { signAccessToken, generateRefreshToken, hashRefreshToken, type DecodedAccessToken } from './jwt';
import { randomUUID } from 'node:crypto';

// ─── Config ────────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes — matches unlock.ts

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RefreshBody {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function authMissing(reply: FastifyReply) {
  return reply.code(401).send({
    error: 'Unauthorized',
    message: 'Missing or malformed refresh token',
  });
}

async function findSessionByRefreshTokenHash(tokenHash: string) {
  const rows = await db.query.sessions.findMany({
    where: and(
      eq(sessions.refreshTokenHash, tokenHash),
      isNull(sessions.deletedAt),
    ),
    orderBy: (s, { desc }) => [desc(s.lastUsedAt)],
    limit: 1,
  });
  return rows[0] ?? null;
}

async function findRefreshTokenRecord(tokenHash: string) {
  const rows = await db.query.refreshTokens.findMany({
    where: and(
      eq(refreshTokens.tokenHash, tokenHash),
      isNull(refreshTokens.deletedAt),
    ),
    limit: 1,
  });
  return rows[0] ?? null;
}

function isTokenExpired(row: { expiresAt: Date } | null): boolean {
  if (!row) return true;
  return row.expiresAt < new Date();
}

function isTokenRevoked(row: { revokedAt: Date | null } | null): boolean {
  if (!row) return true;
  return row.revokedAt !== null;
}

// ─── Plugin ────────────────────────────────────────────────────────────────────

export function refreshPlugin(server: FastifyInstance): void {
  server.post<{ Path: '/auth/refresh'; Schema: { Body: RefreshBody }; Reply: RefreshResponse }>(
    '/auth/refresh',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            refreshToken: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              expiresIn: { type: 'integer' },
              tokenType: { type: 'string', enum: ['Bearer'] },
            },
          },
          401: {
            description: 'Unauthorized — invalid, expired, revoked, or auto-locked refresh token',
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
    async (request: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
      const { refreshToken } = request.body;

      if (typeof refreshToken !== 'string' || !refreshToken) {
        return authMissing(reply);
      }

      // Hash the presented refresh token to look up in DB.
      const tokenHash = hashRefreshToken(refreshToken);

      // Look up the session bound to this refresh token.
      const session = await findSessionByRefreshTokenHash(tokenHash);
      if (!session) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid refresh token',
        });
      }

      // Look up the refresh token record for expiry/revocation check.
      const tokenRecord = await findRefreshTokenRecord(tokenHash);
      if (isTokenRevoked(tokenRecord) || isTokenExpired(tokenRecord)) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Refresh token has been revoked or expired. Please re-unlock.',
        });
      }

      // ── Auto-lock check (BE-002d AC1) ──────────────────────────────────────
      const now = new Date();
      const lastUsed = session.lastUsedAt;
      if (lastUsed) {
        const inactivityMs = now.getTime() - lastUsed.getTime();
        if (inactivityMs > config.autoLockTimeoutMs) {
          return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Session expired due to inactivity. Please re-unlock.',
          });
        }
      }

      // ── Rotate refresh token (BE-002d AC1 — refresh rotation) ──────────────
      const newRawRefreshToken = generateRefreshToken();
      const newRefreshTokenHash = hashRefreshToken(newRawRefreshToken);

      // Revoke the old refresh token.
      await db
        .update(refreshTokens)
        .set({ revokedAt: now, updatedAt: now })
        .where(eq(refreshTokens.tokenHash, tokenHash));

      // Insert the new refresh token record.
      const newExpiresAt = new Date(now.getTime() + 30 * 86400000); // 30 days
      await db.insert(refreshTokens).values({
        id: randomUUID(),
        userId: session.userId,
        tokenHash: newRefreshTokenHash,
        issuedAt: now,
        expiresAt: newExpiresAt,
        createdAt: now,
        updatedAt: now,
      });

      // Update the session to bind the new refresh token hash + bump lastUsedAt.
      await db
        .update(sessions)
        .set({
          refreshTokenHash: newRefreshTokenHash,
          lastUsedAt: now,
          updatedAt: now,
        })
        .where(eq(sessions.id, session.id));

      // ── Issue new access token ──────────────────────────────────────────────
      const accessToken = signAccessToken(session.userId, process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production', ACCESS_TOKEN_TTL_SEC, session.id);

      return reply.code(200).send({
        accessToken,
        refreshToken: newRawRefreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SEC,
        tokenType: 'Bearer',
      });
    },
  );
}
