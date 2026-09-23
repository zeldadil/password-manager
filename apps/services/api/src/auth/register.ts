/** @fileoverview Registration route — POST /auth/register (BE-002a).

 * Accepts a master password, runs the KDF (Argon2id per SEC-001 Decision 1),
 * encrypts the vault key (AES-256-GCM self-wrap, SEC-001 Decision 2+3),
 * and persists the { kdfParams, salt, ciphertext, iv, tag } record to the DB.
 *
 * Also creates the user's vault (ADR-003 §3.2: 1:1 Vault per User in MVP).
 * Nothing else in the codebase creates this row, and every vault-scoped
 * entity (folders, resources, tags — BE-003b+) has a NOT NULL FK to it, so
 * it must exist before the user can use any of those endpoints.
 *
 * AR-2: No real secrets in code — the master password is transient input only,
 *       never logged, never stored.
 * AR-3: Positive + negative tests in tests/auth/register.test.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { users, vaults } from '../schema';
import { eq } from 'drizzle-orm';
import {
  registerMasterPassword,
  type KdfRegistrationRecord,
} from '@password-manager/crypto';
import { randomUUID } from 'node:crypto';

export interface RegisterBody {
  masterPassword: string;
  email: string;
  username: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  username: string;
  kdfParams: {
    algorithm: 'argon2id';
    memory: number;
    iterations: number;
    parallelism: number;
    hashLength: number;
  };
}

export function registerPlugin(server: FastifyInstance): void {
  server.post<{ Body: RegisterBody; Reply: RegisterResponse }>(
    '/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['masterPassword', 'email', 'username'],
          properties: {
            masterPassword: { type: 'string', minLength: 8 },
            email: { type: 'string', format: 'email' },
            username: { type: 'string', minLength: 3, maxLength: 32 },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              username: { type: 'string' },
              kdfParams: {
                type: 'object',
                properties: {
                  algorithm: { type: 'string' },
                  memory: { type: 'integer' },
                  iterations: { type: 'integer' },
                  parallelism: { type: 'integer' },
                  hashLength: { type: 'integer' },
                },
              },
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
          409: {
            description: 'Conflict',
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
    async (request: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
      const { masterPassword, email, username } = request.body;

      const existingEmail = await db.query.users.findFirst({
        where: eq(users.email, email.toLowerCase()),
      });
      if (existingEmail) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'A user with this email already exists',
        });
      }

      const existingUsername = await db.query.users.findFirst({
        where: eq(users.username, username.toLowerCase()),
      });
      if (existingUsername) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'This username is already taken',
        });
      }

      const passwordBuffer = Buffer.from(masterPassword, 'utf-8');
      const record = await registerMasterPassword(passwordBuffer);

      const id = randomUUID();
      const now = new Date();

      await db.insert(users).values({
        id,
        email: email.toLowerCase(),
        username: username.toLowerCase(),
        salt: record.salt,
        kdfParams: JSON.stringify(record.kdfParams),
        vaultKeyEncrypted: record.vaultKeyEncrypted,
        vaultKeyIv: record.vaultKeyIv,
        vaultKeyTag: record.vaultKeyTag,
        failedAttempts: 0,
        lockedUntil: null,
        settings: '{}',
        createdAt: now,
        updatedAt: now,
      });

      // ADR-003 §3.2: exactly one vault per user in MVP, created alongside
      // the user record so every vault-scoped entity's FK is satisfiable
      // from the moment registration completes.
      await db.insert(vaults).values({
        id: randomUUID(),
        ownerId: id,
        name: 'My Vault',
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      return reply.code(201).send({
        id,
        email: email.toLowerCase(),
        username: username.toLowerCase(),
        kdfParams: record.kdfParams,
      });
    },
  );
}
