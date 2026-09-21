/** @fileoverview Unlock route — POST /api/v1/auth/unlock (BE-002b).

 * Accepts a master password + user identifier (email or username), re-derives
 * the vault key from the stored KDF record, decrypts the wrapped vault key,
 * and returns a short-lived JWT (15 min) + a rotated refresh token (30 days).
 *
 * AR-2: No real secrets in logs — the master password is transient input
 *       only, never logged, never stored.
 * AR-3: Positive + negative tests in tests/auth/unlock.test.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { users, sessions, refreshTokens } from '../schema';
import { eq, or } from 'drizzle-orm';
import { unlockVaultKey, type KdfRegistrationRecord } from '@crypto/index';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from './jwt';
import { randomUUID } from 'node:crypto';

// ─── Config ────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production';
const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30;

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
          where: eq(users.username, username.toLowerCase()),
        });
      }

      if (!userRow) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'No user found with the provided identifier',
        });
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
      try {
        vaultKey = await unlockVaultKey(passwordBuffer, record);
      } catch {
        // Decryption failure = wrong master password.
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid master password',
        });
      }

      // Vault key successfully decrypted — issue tokens.
      const userId = userRow.id;
      const accessToken = signAccessToken(userId, JWT_SECRET, ACCESS_TOKEN_TTL_SEC);
      const rawRefreshToken = generateRefreshToken();
      const refreshTokenHash = hashRefreshToken(rawRefreshToken);

      const now = new Date();
      const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 86400000);

      const sessionId = randomUUID();
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
