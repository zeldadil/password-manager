/** @fileoverview Unlock route - POST /auth/unlock (BE-002b + BE-002e).
 *
 * Accepts a master password + user identifier (email or username), re-derives
 * the vault key from the stored KDF record, decrypts the wrapped vault key,
 * and returns a short-lived JWT (15 min) + a rotated refresh token (30 days).
 *
 * BE-002e additions:
 *   - Constant-time comparison: timingSafeEqual for secret comparisons.
 *   - Generic error: both "user not found" and "wrong password" return 401
 *     with "Invalid credentials" - no user-enumeration leak.
 *   - Rate limiting: 5 consecutive failed attempts -> 15-minute lockout.
 *     failedAttempts counter resets on success or lockout expiry.
 *   - Dummy KDF for non-existent users: prevents timing-based user enumeration.
 *
 * AR-2: No real secrets in logs - the master password is transient input
 *       only, never logged, never stored.
 * AR-3: Tests in tests/auth/unlock.test.ts + wrong-password.test.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { users, sessions, refreshTokens } from '../schema';
import { eq, or } from 'drizzle-orm';
import { unlockVaultKey, deriveVaultKey, type KdfRegistrationRecord } from '@crypto/index';
import { config } from '../config';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from './jwt';
import { randomUUID, timingSafeEqual } from 'node:crypto';

// ─── Config ────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production';
const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface UnlockBody {
  masterPassword: string;
  email?: string;
  username?: string;
}

export interface UnlockResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

// ─── Constant-time helpers ─────────────────────────────────────────────────────

/** Timing-safe Buffer equality - prevents timing attacks on secret comparisons. */
function timingSafeBufEq(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Dummy KDF burn - prevents timing-based user enumeration.
 *
 * When a user doesn't exist, we still run Argon2id for ~1s with a random salt
 * so that the response time is indistinguishable from a real unlock attempt
 * with a wrong password.
 */
async function burnDummyKdf(): Promise<void> {
  const dummySalt = Buffer.alloc(16);
  for (let i = 0; i < dummySalt.length; i++) {
    dummySalt[i] = Math.floor(Math.random() * 256);
  }
  await deriveVaultKey(Buffer.from('dummy'), dummySalt);
}

/** Generic auth failure response - same for wrong password and unknown user. */
async function sendGenericAuthError(reply: FastifyReply): Promise<void> {
  return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid credentials' });
}

// ─── Plugin ────────────────────────────────────────────────────────────────────

export function unlockPlugin(server: FastifyInstance): void {
  server.post<{ Path: '/auth/unlock'; Schema: { Body: UnlockBody }; Reply: UnlockResponse }>(
    '/auth/unlock',
    {
      schema: {
        body: {
          type: 'object',
          required: ['masterPassword'],
          properties: {
            masterPassword: { type: 'string', minLength: 8 },
            email: { type: 'string', format: 'email' },
            username: { type: 'string', minLength: 3, maxLength: 32 },
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
          400: {
            description: 'Bad Request',
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
          401: {
            description: 'Unauthorized',
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
          404: {
            description: 'Not Found',
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
    async (request: FastifyRequest<{ Body: UnlockBody }>, reply: FastifyReply) => {
      const { masterPassword, email, username } = request.body;

      // Must provide at least one user identifier.
      if (!email && !username) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Either email or username is required to identify the user',
        });
      }

      // Look up user by email OR username.
      let userRow;
      if (email && username) {
        userRow = await db.query.users.findFirst({
          where: or(eq(users.email, email.toLowerCase()), eq(users.username, username.toLowerCase())),
        });
      } else if (email) {
        userRow = await db.query.users.findFirst({
          where: eq(users.email, email.toLowerCase()),
        });
  } else {
        userRow = await db.query.users.findFirst({
          where: eq(users.username, username!.toLowerCase()),
        });
      }

      // ── Rate limit check ─────────────────────────────────────────────────
      // If locked out, reject immediately with generic 401.
      if (userRow) {
        const nowMs = Date.now();
        const lockedUntil = userRow.lockedUntil
          ? new Date(userRow.lockedUntil).getTime()
          : 0;

        if (lockedUntil > nowMs) {
          return await sendGenericAuthError(reply);
        }

        // Lockout expired - reset counter and clear lockout.
        if (lockedUntil > 0) {
          await db
            .update(users)
            .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
            .where(eq(users.id, userRow.id));
          // Re-fetch fresh state.
          userRow = await db.query.users.findFirst({
            where: eq(users.id, userRow.id),
          });
        }
      }

      // ── User not found - burn dummy KDF, then generic 401 (AC1) ─────────
      if (!userRow) {
        await burnDummyKdf();
        return await sendGenericAuthError(reply);
      }

      // Reconstruct KDF registration record from DB columns.
      const record: KdfRegistrationRecord = {
        kdfParams: typeof userRow.kdfParams === 'string'
          ? JSON.parse(userRow.kdfParams)
          : userRow.kdfParams,
        salt: userRow.salt,
        vaultKeyEncrypted: userRow.vaultKeyEncrypted,
        vaultKeyIv: userRow.vaultKeyIv,
        vaultKeyTag: userRow.vaultKeyTag,
      };

      const passwordBuffer = Buffer.from(masterPassword, 'utf-8');
      let vaultKey: Buffer;
      const now = new Date();
      try {
        vaultKey = await unlockVaultKey(passwordBuffer, record);
      } catch {
        // Decryption failure = wrong master password.
        // Increment failed attempts counter (AC1 rate limiting).
        const newFailedAttempts = (userRow.failedAttempts ?? 0) + 1;

        if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
          // Lock out for 15 minutes.
          const lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
          await db
            .update(users)
            .set({
              failedAttempts: newFailedAttempts,
              lockedUntil,
              updatedAt: now,
            })
            .where(eq(users.id, userRow.id));
        } else {
          await db
            .update(users)
            .set({ failedAttempts: newFailedAttempts, updatedAt: now })
            .where(eq(users.id, userRow.id));
        }

        // Generic 401 - never reveal "wrong password" vs "user not found".
        return await sendGenericAuthError(reply);
      }

      // ── Success - reset counter, issue tokens ───────────────────────────
      const userId = userRow.id;

      // Reset failed-attempts counter on successful unlock.
      await db
        .update(users)
        .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
        .where(eq(users.id, userId));

      const sessionId = randomUUID();
      const accessToken = signAccessToken(userId, JWT_SECRET, ACCESS_TOKEN_TTL_SEC, sessionId);
      const rawRefreshToken = generateRefreshToken();
      const refreshTokenHash = hashRefreshToken(rawRefreshToken);

      const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 86400000);

      await db.insert(sessions).values({
        id: sessionId,
        userId,
        refreshTokenHash,
        expiresAt,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(refreshTokens).values({
        id: randomUUID(),
        userId,
        tokenHash: refreshTokenHash,
        issuedAt: now,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      return reply.code(200).send({
        accessToken,
        refreshToken: rawRefreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SEC,
        tokenType: 'Bearer',
      });
    },
  );
}
