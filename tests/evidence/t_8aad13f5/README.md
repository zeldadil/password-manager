# t_8aad13f5 — QA independent verification (round 1)

Reviewed: origin/master 38f3dae0efa3617ece56e5b26909cb49d0231410 (contains dd7ec14 / PR #133),
Node v22.23.3 (tarball sha256 checked vs SHASUMS256.txt), pnpm 9.12.0 via corepack shim.

- `verify.sh` -> `transcript-run1.txt`: .env.example / db.ts / docs inspection, P3 loader grep,
  P1 (export flow, migrate x2, /health 200 on PORT from the file), P1b (./dev.db exit 0),
  P2 (file:./dev.db exit 1, "Cannot open database because the directory does not exist").
  NOTE: the P1c line in run1 is INVALID — run1's P1 server was not killed (pnpm->tsx->node
  grandchild survived `pkill -P`), so :3927 was still answered by the P1 server. Superseded by run2.
- `verify2.sh` -> `transcript-run2.txt`: P1 and P1c re-run with `setsid` + process-group kill and
  port-free pre/post checks. P1c: with `.env.local` present at repo root and in apps/services/api
  but NOT exported, the API listens on the default :3000 and :3927 is closed (http 000) ->
  nothing auto-loads `.env.local`, as the docs state.

Secret hygiene: only synthetic .env.example values; JWT_SECRET line redacted in the transcript.
