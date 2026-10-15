# t_dbecf24d — round 2 evidence (2026-10-11): hook reinstall from master + R9 live fires

Round 1 (2026-10-08, PR #121, `tests/evidence/t_dbecf24d/`) installed gate fdaabca. That copy
predates 6d0d3ac (§5.9: audit counts A11) and 92f01d7 (§5.6: exception withdrawal), so
criterion 1 had to be redone from a master at or after 92f01d7 (card comment of 2026-10-09).

Source: origin/master 0930d9f (92f01d7 and 6d0d3ac are ancestors, checked with
`git merge-base --is-ancestor`).
- `scripts/qa/signoff-gate.mjs` sha256 e1478eb9139aaaa622f963e784e9b3dbd0b1a0196edcde689cb4284a0ba9e60b
- `scripts/qa/hooks/qa-signoff-gate.sh` sha256 4e1efa9e2e03bc2ccf447f2b8861ff0216f9482574ea46a6793afe707b28c2de

## Criterion 1: reinstall in the 7 profiles + verifier output

- `pre-install-hashes.txt`: before, all 7 ran gate 3c2d72b3… (fdaabca).
- `install-all-dryrun.txt`: `install-signoff-gate.sh --all` now selects 8 directories. The 8th is
  `duckai`, which is not one of the project's 7 agent profiles, and its config fails the
  installer's dry-run validation (exit 1). I did not install into it. The apply ran on the
  7 profiles named explicitly (`--profile` x7 `--apply`), see `rollout.sh`.
- `install-apply.txt`: exit 0, 7/7 copied, configs already carried the entry (idempotent).
- `verify-live.txt`: `verify-signoff-gate.sh --profile x7 --live` on the selftest fixture board:
  **84 ok · 7 warn · 0 FAIL, exit 0**. The 7 warn are the expected post-install mtime drift on
  the sign-off hook (one per profile). The round-1 verifier false FAILs (pipefail and
  unrelated doctor warnings) no longer appear.
- Re-hashed independently after install: all 7 `agent-hooks/signoff-gate.mjs` = e1478eb9…,
  all 7 `qa-signoff-gate.sh` = 4e1efa9e… (see `post-install/fires.txt`, "installed gate sha256").

## Criterion 2: gh auth inside the hook env + R9 (not A11) per profile

Script: `fire-profiles.sh <phase> t_fx148r9 148 inject`. For each profile, three fires through
`hermes hooks test pre_tool_call --for-tool kanban_complete` with `HERMES_HOME=<profile>` (the real
dispatcher hook path, not an interactive shell):
- A. probe (`hook-env-gh-probe.mjs` as the gate script): `gh auth status` exit 0, from hosts.yml,
  GH_TOKEN/GITHUB_TOKEN not set; then the installed gate's `check --pre-complete --json`.
- B. real installed hook, GitHub live: block, `R9_PR_NOT_MERGED` present, A11 absent.
- C. control, `QA_GATE_GITHUB=off`: R9 disappears. This proves that B's R9 comes from reading GitHub.

Fixture: PR #110 (round-1 fixture) is now merged, and t_dbecf24d is satisfied by its merged PR
#121, so neither can produce R9 any more (`pre-install-selfcard-no-r9/` shows the 0/7 attempt on
the self-card). The R9 fixture is `t_fx148r9`, injected **only into a sqlite `.backup` snapshot**
of the board. The script refuses to run if that id exists on the live board. It is declared by
the `Closes t_fx148r9` line in the body of PR #148 (this PR, OPEN at fire time; re-read live
in each fires.txt header).

Results:
- `pre-install/fires.txt` (fdaabca copy): 7 PASS / 0 FAIL. The R9 rule was already in fdaabca.
- `post-install/fires.txt` (0930d9f copy): **7 PASS / 0 FAIL**: gh auth exit 0, R9=true,
  A11=false on every profile; control R9=0 on every profile.

Fixture limitation: the injected card also gets `R4_EVIDENCE_MISSING`, because its synthetic
verdict cites `QA_SIGN_OFF_GATE.md`, which the gate does not accept as evidence from the hook's
cwd. That is a second violation next to R9 and does not change the R9/A11 reading: the A/B
against the control isolates R9. Same limit as round 1: these are hook fires per profile, not
real worker completions.

## Criterion 3

Not proven here. The expected proof is the first real scheduled run of the local weekly audit
(qa cron `qa-weekly-signoff-audit`, next run 2026-10-12T06:17Z, `--fail-on-a11`) posting its
`AUDIT-RUN:` summary with the A11 count on t_9c3f521a (architect comment, 2026-10-11).

No secret values in this directory: grep for gh token prefixes / `Token:` lines is empty.
