/** @fileoverview Auth plugin aggregator — registers all /auth routes.

 * BE-002a: POST /auth/register (registerPlugin)
 * BE-002b: POST /auth/unlock  (unlockPlugin)
 * BE-002c: POST /auth/lock   + GET /auth/status (lockPlugin)
 *
 * Keeps server.ts clean: one import, one registration call.
 */

import type { FastifyInstance } from 'fastify';
import { registerPlugin } from './register';
import { unlockPlugin } from './unlock';
import { lockPlugin } from './lock';
import { refreshPlugin } from './refresh';

export function authPlugin(server: FastifyInstance): void {
  registerPlugin(server);
  unlockPlugin(server);
  lockPlugin(server);
  refreshPlugin(server);
}
