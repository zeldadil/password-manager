repo HEAD: a48d62227f17f438cfc3728982c5bb639721fbb1  node: v22.23.3
=== P1 env-file loaders (dotenv / --env-file / loadEnvFile / .env.local) in api src + package scripts
P1: no match (nothing loads .env.local for the API)
api dev script: tsx watch src/index.ts
=== P2 better-sqlite3 with DATABASE_URL=file:./dev.db
install exit=0
/home/sap/.hermes/kanban/workspaces/t_372385ea/repo/node_modules/.pnpm/better-sqlite3@9.6.0/node_modules/better-sqlite3/lib/database.js:65
		throw new TypeError('Cannot open database because the directory does not exist');
		^

TypeError: Cannot open database because the directory does not exist
    at new Database (/home/sap/.hermes/kanban/workspaces/t_372385ea/repo/node_modules/.pnpm/better-sqlite3@9.6.0/node_modules/better-sqlite3/lib/database.js:65:9)
    at Object.<anonymous> (/home/sap/.hermes/kanban/workspaces/t_372385ea/repo/apps/services/api/qa-probe.cjs:3:12)
    at Module._compile (node:internal/modules/cjs/loader:1781:14)
    at Object..js (node:internal/modules/cjs/loader:1913:10)
    at Module.load (node:internal/modules/cjs/loader:1505:32)
    at Function._load (node:internal/modules/cjs/loader:1309:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
    at node:internal/main/run_main_module:36:49

Node.js v22.23.3
probe exit=1
=== P2b real API entry point (apps/services/api src/index.ts) with DATABASE_URL=file:./dev.db, cwd=/home/sap/.hermes/profiles/qa/cache/scratch/t_372385ea-sqlite-probe
		throw new TypeError('Cannot open database because the directory does not exist');
TypeError: Cannot open database because the directory does not exist
(end P2b)
=== P2c same entry point with the documented default (DATABASE_URL unset) for contrast
{"level":30,"time":1791538242235,"pid":39510,"hostname":"ai-server","msg":"Server listening at http://127.0.0.1:39118"}
[api] @password-manager/api v0.1.0 listening at http://127.0.0.1:39118 (development)
(timeout 124 = still running = started fine)
=== P3 master password in API request bodies / web client
apps/services/api/src/auth/register.ts:53:          required: ['masterPassword', 'email', 'username'],
apps/services/api/src/auth/register.ts:111:      const { masterPassword, email, username } = request.body;
apps/services/api/src/auth/register.ts:133:      const passwordBuffer = Buffer.from(masterPassword, 'utf-8');
apps/services/api/src/auth/unlock.ts:87:          required: ['masterPassword'],
apps/services/api/src/auth/unlock.ts:150:      const { masterPassword, email, username } = request.body;
apps/services/api/src/auth/unlock.ts:218:      const passwordBuffer = Buffer.from(masterPassword, 'utf-8');
apps/web/src/pages/LoginPage.tsx:99:        body: JSON.stringify({ masterPassword, email }),
apps/web/src/pages/UnlockPage.tsx:99:        body: JSON.stringify({ masterPassword, email }),
=== P3b README claims under test
12:  encryption is not yet wired** — awaiting Option B design approval (t_3f1b0521).
29:- Not OpenPGP-based — uses symmetric AEAD with a client-derived vault key.
30:- Not server-side keyring recovery — the server never sees the master password.
=== P4 duplicated Node paragraph (Prerequisites vs Quick start)
2
66:  refuses to run on an unsupported Node version (`ERR_PNPM_UNSUPPORTED_ENGINE`,
86:The web test suites fail on Node 26 (jsdom's `AbortSignal` conflicts with the `undici`-backed global `fetch`; Node 23–25 untested), so use the pinned version: `nvm use` (or `fnm use`) reads `.nvmrc`. `pnpm install` refuses to run on an unsupported Node version (`ERR_PNPM_UNSUPPORTED_ENGINE`, enforced by `engine-strict=true` in `.npmrc`).
=== P5 setup guide referenced by README
ls: cannot access 'docs/development/setup.md': No such file or directory
