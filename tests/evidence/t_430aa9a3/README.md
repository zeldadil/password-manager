# Evidence — QA-001h (`t_430aa9a3`): QA Sign-off Gate Policy

**Deliverable:** `QA_SIGN_OFF_GATE.md` (policy) + `scripts/qa/signoff-gate.mjs` (enforcement) +
`scripts/qa/hooks/*` (install / verify the `pre_tool_call` hook that blocks `kanban_complete`).

**Test types:** `meta` — the gate is a process control, so its evidence is (a) a non-vacuity proof that
every rule fires, (b) a live fire through Hermes' own hook dispatcher in every profile, and (c) the
audit of the real board at activation.

## Files

| File | What it proves |
|---|---|
| `selftest.txt` | `node scripts/qa/signoff-gate.selftest.mjs` → **33/33 cases**: every rule `R1`–`R8` fires on its own non-compliant fixture card, every compliant control card yields **zero** violations (anti-vacuous control), the `--strict-history` behaviour is correct, and the hook blocks / allows / fails closed / honours the kill switch. |
| `audit-fixture-board.txt` | Audit of the same non-vacuous fixture board: 19 enforced cards → 9 pass, **10 FAIL** with the exact rule ids; plus the machine-readable `--json` counts. |
| `audit-real-board.txt` | Audit of the live board at activation: **0 enforced failures**, 26 cards grandfathered (pre-epoch) with `A1_HISTORY_UNGATED` advisories; `--strict-history` view shows 25 of those 26 pre-epoch cards have no verdict/evidence (the retrofit backlog). |
| `live-fire-<profile>.txt` (7) | `hermes hooks test pre_tool_call --for-tool kanban_complete` against a fixture board, for every installed profile: non-compliant card → `exit=2` + `{"action":"block","message":…}`; compliant card → `exit=0` + `{}` (no dispatcher contribution). |
| `verify-all-live.txt` | `scripts/qa/hooks/verify-signoff-gate.sh --all --live` → **91 checks, 0 failures** across the 7 profiles: installed + executable, SHA-256 matches the reviewed repo copy, config carries the entry with `fail_closed: true` + `hooks_auto_accept: true`, `hermes config get hooks` resolves it, `hermes hooks list` shows it, `hermes hooks doctor` clean, both live-fire paths correct. |
| `hook-wiring.txt` | Installer dry run, the resulting `hooks:` block in a profile `config.yaml`, `hermes hooks list`, `hermes hooks doctor`. |
| `hooks-doctor-qa.txt` | `hermes hooks doctor` transcript for the `qa` profile. |
| `reproduce.sh` | Regenerates every transcript above (builds its own fixture board in a temp dir; mutates nothing on the board or in any profile). |

## Reproduction

```
bash tests/evidence/t_430aa9a3/reproduce.sh              # all transcripts
node scripts/qa/signoff-gate.selftest.mjs                # 33/33, exit 0
node scripts/qa/signoff-gate.mjs audit --db ~/.hermes/kanban.db   # exit 0 at activation
```

Run on Node v22.23.2 · SQLite 3.45.1 · Hermes profile hooks (`pre_tool_call`, `fail_closed: true`).

## What was actually changed outside the repo

The gate only enforces anything if the hook is installed where the workers run, so the rollout is part
of the deliverable (recorded in `QA_SIGN_OFF_GATE.md` §9):

- `<profile>/agent-hooks/qa-signoff-gate.sh` + `signoff-gate.mjs` installed for **architect, backend,
  browser, docs, frontend, product, qa** (7 profiles).
- `<profile>/config.yaml` — `hooks.pre_tool_call` entry (`matcher: ^kanban_complete$`, `timeout: 30`,
  `fail_closed: true`) + `hooks_auto_accept: true` (required for non-TTY dispatcher workers).
  Backups: `<profile>/config.yaml.bak.2026091714*`.
- Kill switch (documented, operational): `touch ~/.hermes/signoff-gate.disabled`.
- Rollback: restore the `.bak` config and delete `<profile>/agent-hooks/`.

## Residual / not covered here

- A real dispatched worker completing a real card is the natural first end-to-end run of the gate; the
  live fires above exercise the same dispatcher path (`shell_hooks.run_once` → same payload serializer →
  same block parsing) on a fixture board, so the remaining unknown is only the worker's own
  `HERMES_KANBAN_DB`/cwd plumbing — which is what the fixture fire reproduces.
- Pre-epoch backlog retrofit (25 cards) and CI wiring of the audit are open items in
  `QA_SIGN_OFF_GATE.md` §10, routed to `architect`.
