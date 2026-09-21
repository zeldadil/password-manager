/** @license
 * Public entry point for @password-manager/shared (workspace mirror).
 *
 * Re-exports all shared contracts so consumers can import from the package
 * root (e.g. `import { Envelope, ParsedQuery } from '@shared'`).
 * ADR-002 §2.3: single source of truth for message types, entity shapes,
 * and validation helpers shared across web / extension / API.
 *
 * NOTE: This is the t_143990ec workspace-local mirror of
 * /home/sap/password-manager/.worktrees/t_7c572465/packages/shared/src/index.ts.
 * The canonical source is in the parent worktree; this copy is self-contained
 * so vitest can resolve @shared/* without a full pnpm install.
 */

export * from './envelope';
export * from './query';
