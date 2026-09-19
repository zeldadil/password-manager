/**
 * Public entry point for @password-manager/shared.
 *
 * Re-exports all shared contracts so consumers can import from the package
 * root (e.g. `import { Envelope } from '@password-manager/shared'`).
 * ADR-002 §2.3: single source of truth for message types, entity shapes,
 * and validation helpers shared across web / extension / API.
 */

export type * from './envelope';
