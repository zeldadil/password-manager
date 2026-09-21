/** @fileoverview Unlock route — POST /auth/unlock (BE-002b).

 * Accepts email + master password, runs the KDF (Argon2id), decrypts the
 * vault key, and returns a short-lived JWT (15m) + refresh token (30d, rotation).
 *
 * AR-2: No real secrets in logs or responses — master password is transient
 *       input only; tokens are opaque to the client; the vault key lives only
 *       in server memory.
 * AR-3: Positive + negative tests in tests/auth/unlock.test.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { users, refreshTokens } from '../schema';
import { eq } from 'drizzle-orm';
import {
  unlockVaultKey,
  type KdfRegistrationRecord,
} from '@crypto/index';
import {
  signAccessToken,
  signRefreshToken,
} from '@crypto/jwt';
import { randomUUID, createHash } from 'node:crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UnlockBody {
  email: string;
  masterPassword: string;
}

export interface UnlockResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expiry
  user: {
    id: string;
    email: string;
    username: string;
  };
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export function unlockPlugin(server: FastifyInstance): void {
  server.post<{ Path: '/auth/unlock'; Schema: { Body: UnlockBody }; Reply: UnlockResponse }>(
    '/auth/unlock',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'masterPassword'],
          properties: {
            email: { type: 'string', format: 'email' },
            masterPassword: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              expiresIn: { type: 'integer' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                  username: { type: 'string' },
                },
              },
            },
          },
          400: {
            description: 'Bad Request — missing or invalid body',
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
            description: 'Unauthorized — wrong master password or unknown user',
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
      const { email, masterPassword } = request.body;
      const lowerEmail = email.toLowerCase();

      const user = await db.query.users.findFirst({
        where: eq(users.email, lowerEmail),
      });

      if (!user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid credentials',
        });
      }

      // Reconstruct KDF registration record from DB columns.
      // Drizzle's mode:'json' may or may not auto-parse; be defensive.
      const rawParams = user.kdfParams;
      const kdfParams =
        typeof rawParams === 'string'
          ? (JSON.parse(rawParams) as Parameters<typeof unlockVaultKey>[1]['kdfParams'])
          : (rawParams as Parameters<typeof unlockVaultKey>[1]['kdfParams']);

      const record: KdfRegistrationRecord = {
        kdfParams,
        salt: user.salt,
        vaultKeyEncrypted: user.vaultKeyEncrypted,
        vaultKeyIv: user.vaultKeyIv,
        vaultKeyTag: user.vaultKeyTag,
      };

      const passwordBuffer = Buffer.from(masterPassword, 'utf-8');

      let vaultKey: Buffer;
      try {
        vaultKey = await unlockVaultKey(passwordBuffer, record);
      } catch {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid credentials',
        });
      }

      // --- Issue tokens -------------------------------------------------
      const jwtSecret = process.env.JWT_SECRET ?? 'pm-dev-secret-change-in-prod';

      const accessTokenResult = signAccessToken(user.id, jwtSecret);
      const refreshTokenResult = signRefreshToken(user.id, jwtSecret);

      // Persist refresh token hash for rotation/revocation (SEC-001 Decision 6)
      const tokenHash = createHash('sha256')
        .update(refreshTokenResult.token)
        .digest('hex');

      await db.insert(refreshTokens).values({
        id: randomUUID(),
        userId: user.id,
        tokenHash,
        userAgent: request.headers['user-agent'] ?? null,
        ipAddress: request.ip ?? null,
        issuedAt: new Date(),
        expiresAt: refreshTokenResult.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return reply.code(200).send({
        accessToken: accessTokenResult.token,
        refreshToken: refreshTokenResult.token,
        expiresIn: Math.floor(
          (accessTokenResult.expiresAt.getTime() - Date.now()) / 1000,
        ),
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
        },
      });
    },
  );
}
