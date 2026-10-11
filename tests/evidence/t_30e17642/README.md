# t_30e17642 — merge-guard: evidence

SEC-GATE card: block PR merges from every Hermes profile except `architect` with a `pre_tool_call` hook.
Collected 2026-10-11 on the board host (`ai-server`) by `qa`. Doc: `QA_SIGN_OFF_GATE.md` §6.6.

Conflict of interest (card note): `qa` wrote a lock that targets `qa` itself. Independent counter-verification and the
merge are architect's. Nothing in this evidence was produced by the hook's author alone without a reproducible
command: every file below says how it was made.

## Acceptance criteria → evidence

| AC | What | Evidence |
|---|---|---|
| 1 | Hook `merge-guard.sh` (same shape as `secret-guard.sh`: bash wrapper + node logic, fail closed) refuses `gh pr merge`, `gh api … pulls/<n>/merge`, `-X PUT …/merge`, with/without `-R`/`--repo`, after `&&` / `;`; the refusal says "le merge revient à architect" and cites §5.9 | `selftest.txt` section A (55 refused forms), `live-qa-session-20261011_101446_c67355.txt` |
| 1 | Installed in all profiles except `architect` | `install-apply.txt`, `hooks-list-per-profile.txt`, `verify-live.txt` (incl. the architect exclusion check) |
| 2 | No blocking false positive: `gh pr view/checks/create/list`, `git merge-base`, local `git merge` allowed; ≥ 6 refused and ≥ 6 allowed cases | `selftest.txt` sections A (55) and B (24); `live-qa-session-20261011_101531_c83bf2.txt` (real allowed path) |
| 3 | Installer sets the hook in each profile (but architect); `hermes hooks list` per profile; a real `gh pr merge` on a non-existent PR refused by the hook from the `qa` profile | `install-apply.txt`, `hooks-list-per-profile.txt`, `live-qa-session-20261011_101446_c67355.txt` |

## Files

- `selftest.txt` — `node scripts/qa/merge-guard.selftest.mjs --verbose` (Node v26.7.0, host). 90 passed, 0 failed.
  The CI job `merge-guard-selftest` (`.github/workflows/qa-signoff-audit.yml`) runs it on Node 22.
- `selftest-mutations.txt` — non-vacuity: the selftest run against 4 mutated gates (allow-all: 58 failures;
  block-all: 41; naive `gh pr merge` substring match: 22; data-head exemption removed: 4). Every mutation is caught.
- `install-dry-run.txt`, `install-apply.txt` (rehearsal on fixture copies: `install-rehearsal-fixture.txt`) — `scripts/qa/hooks/install-merge-guard.sh --all` then `--all --apply` on
  the real `~/.hermes/profiles`. Each profile: hook copied, `config.yaml` patched (backup `config.yaml.bak.<ts>`
  left next to it), consent recorded, `hermes hooks list` checked. The installer refuses `--profile architect`
  (exit 3) and `--all` skips it. Rehearsed first on copies of every real `config.yaml` plus two synthetic shapes
  (no `hooks:` key and no trailing newline; `hooks:` with only `post_tool_call`); re-applying is a no-op.
- `hooks-list-per-profile.txt` — `HERMES_HOME=~/.hermes/profiles/<p> hermes hooks list` for all 8 profiles: the
  merge-guard entry is listed `✓ allowed` in `backend`, `browser`, `docs`, `duckai`, `frontend`, `product`, `qa`,
  and absent from `architect`.
- `verify-live.txt` — `scripts/qa/hooks/verify-merge-guard.sh --all --live`: 93 ok, 0 FAIL. Per profile: installed
  copies match the repo (sha256), config entry with `fail_closed: true` and the full matcher, `hermes hooks list`
  `✓ allowed`, `hermes hooks doctor` clean on the merge-guard entry, and `hermes hooks test` (Hermes's production
  hook path) blocking `gh pr merge` and `gh api -X PUT …/merge` and allowing `gh pr view` and `git merge-base`;
  plus "architect carries no merge-guard".
- `verify-negative-controls.txt` — the verifier fails when it should (on fixture copies, never the real profiles):
  an allow-all gate (3 FAIL), the config entry removed (9 FAIL), merge-guard planted in architect (1 FAIL); the
  restored fixture verifies clean again.
- `live-qa-session-20261011_101446_c67355.txt` (+ `.stream.jsonl`, prompt `live-query-block.txt`) — **the real
  attempt**. A fresh `qa` agent session (`hermes -p qa chat --oneshot -t terminal`) called the terminal tool with
  `gh pr merge 999999 -R zeldadil/password-manager --squash`. Row 13021 of the qa `state.db` `messages` table — the
  tool result, not the model's reply — is the hook's block message `merge-guard: blocked — R_GH_PR_MERGE …: le merge
  revient à architect (QA_SIGN_OFF_GATE.md §5.9 …)`. `agent.log` shows that terminal call took 0.06 s (the hook);
  `live-qa-hook-registration.txt` shows the hook registered at that session's start (10:14:45).
  Control: the same command from the `qa` session that did the install (started before it, so without the hook)
  reached GitHub and returned `GraphQL: Could not resolve to a PullRequest with the number of 999999` — the PR does
  not exist, and the difference between the two outcomes is the hook.
- `live-qa-session-20261011_101531_c83bf2.txt` (+ `.stream.jsonl`, prompt `live-query-allow.txt`) — allowed-path
  control in a second fresh `qa` session: `gh pr view 999999 …` reached GitHub (rows 13041) and `git merge-base`
  returned the master hash (row 13045). The tool result also shows the repo's `CLAUDE.md` being injected into the
  agent's context — see finding 1 below.

## Findings for architect (not fixed here — scope boundary)

1. **`CLAUDE.md` at the repo root tells any agent its mission is to merge PRs.** Hermes injects it as
   "Subdirectory context discovered" into the tool result the first time an agent touches the repo (visible in
   `live-qa-session-20261011_101531_c83bf2.txt`). Its text: "Ta mission : merger les PR ouvertes restantes vers
   `master`" and step 8 "`gh pr merge <N> --squash --delete-branch`". That is a plausible cause of the 2026-10-09
   self-merges (#124, #125). The guard now refuses the command, but the instruction still steers agents toward it.
   Owner decision: archive/rename the file or put a banner on it.
2. **The default profile (`~/.hermes`, the gateway / Adil's chat) is not guarded.** It is not under
   `~/.hermes/profiles/`, so `--all` does not see it, and the card exempts Adil's own merges. If the default profile
   also runs agent work, it needs a decision.
3. **`duckai` had no hooks and no `hooks_auto_accept`.** The card says "every profile except architect", so it is
   guarded too; its consent is recorded explicitly by the installer (`approve-hook.py`, the same record Hermes
   writes). No `hooks_auto_accept` was added.
4. **Running sessions keep the hooks they started with.** Any worker running at install time (10:14 UTC) is not
   guarded until it restarts. Seen directly: the installing session itself was not blocked.
5. **Pre-existing drift, unrelated to this card:** `hermes hooks doctor` flags `qa-signoff-gate.sh` (modified
   2026-10-11 ~09:58 in every profile) and `secret-guard.sh` (several profiles) as "modified since approval". Listed
   in `hooks-list-per-profile.txt`; not touched here.

## Residual paths (a guard, not a sandbox)

- A command assembled at run time is not recognised — probed with the real gate (`residual-probe.txt`):
  `g=gh; $g pr merge 1`, `echo <base64> | base64 -d | bash` and a Python `"g"+"h"` list are all ALLOWED. A script
  written with `write_file` then run is not seen either. (Plain re-quoting such as `"g""h" pr merge 1` is caught.)
  The guard targets merging by habit or by an old runbook, which is what happened on 2026-10-09.
- A browser click on GitHub's "Merge" button (browser tools) is not covered.
- A direct `git push` to `master` is not a PR merge. GitHub already rejects it: `master` protection requires a pull
  request and the 8 required checks, with `enforce_admins: true` (read 2026-10-11 via
  `gh api repos/zeldadil/password-manager/branches/master/protection`).
- An agent can edit its own `config.yaml` to remove the hook. There is no defense against that from inside the
  profile; `verify-merge-guard.sh --all` detects it after the fact.
- Text mentioning `pulls/<n>/merge` or `mergePullRequest` (e.g. a grep for it) is refused even when nothing would be
  merged. It is a deliberate over-match: the card asks to refuse those paths outright.

## Rollback

Per profile: restore `~/.hermes/profiles/<p>/config.yaml.bak.20261011101350`…`101408` (one per profile, listed in
`install-apply.txt`) or delete the merge-guard entry, then
`HERMES_HOME=~/.hermes/profiles/<p> hermes hooks revoke ~/.hermes/profiles/<p>/agent-hooks/merge-guard.sh`.
