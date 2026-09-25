/** @fileoverview Runtime configuration for the API service.

 * Single source of truth for the version string is the package.json
 * `version` field (currently 0.1.0 pre-release). Host/port/nodeEnv come
 * from the environment so the same binary runs in dev, test, and prod.
 *
 * Security boundary (ADR-002 Sec 5.1, SEC-001 AR-2): this module holds NO
 * secrets — only non-secret runtime knobs. Master passwords, vault keys,
 * salts, and ciphertext never pass through here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface PackageJson {
  name: string;
  version: string;
}

// Resolved via fileURLToPath + path.join rather than `new URL(..., import.meta.url)`
// so this doesn't depend on the global `URL` constructor — some test environments
// (e.g. Vitest's jsdom environment, used by FE-002g's cross-package integration
// suites that import this server module for real HTTP testing) shim the global
// `URL` with a browser-semantics implementation that rejects `file:` scheme
// results from a relative-path + base-URL construction. `fileURLToPath` uses
// Node's own WHATWG URL parsing internally, independent of that global.
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;

export interface ApiConfig {
  /** Semver from package.json (e.g. "0.1.0"). */
  readonly version: string;
  /** Package name (e.g. "@password-manager/api"). */
  readonly name: string;
  /** TCP port to listen on (env: PORT, default 3000). */
  readonly port: number;
  /** Host/interface to bind (env: HOST, default 127.0.0.1). */
  readonly host: string;
  /** NODE_ENV — "development" | "test" | "production". */
  readonly nodeEnv: string;
  /**
   * Auto-lock timeout in milliseconds.
   * If a session has no activity (no refresh) for longer than this,
   * the session is considered auto-locked and the user must re-unlock
   * with their master password. Default: 15 minutes.
   * Env: AUTO_LOCK_TIMEOUT_MS (integer milliseconds).
   */
  readonly autoLockTimeoutMs: number;
}

export const config: ApiConfig = {
  version: pkg.version,
  name: pkg.name,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  autoLockTimeoutMs: parseInt(process.env.AUTO_LOCK_TIMEOUT_MS ?? '', 10) || 15 * 60 * 1000,
};
