# Decisions Log — QA sign-off gate board transport (t_527d4720)

Added 2026-09-17 by `architect` (this card). Each entry records what was decided, by whom, and the rationale.

This card is a follow-up to CI-001h (`t_ea0783c5`, PR #17): the scheduled `qa-signoff-audit`
workflow ships and is verified, but a GitHub-hosted runner structurally cannot see the canonical
board (`~/.hermes/kanban.db` on the trusted host), so the weekly run is red until the board
transport lands. This doc records the transport decision.

### Board transport for the scheduled audit (follow-up to CI-001h §10.1)

- **Decision:** The scheduled `qa-signoff-audit` workflow runs on a **self-hosted runner** registered
  on the trusted host, driven by the repository variable `QA_SIGNOFF_AUDIT_RUNNER`. No board file
  leaves the host. The workflow's `runs-on` already reads that variable as an escape hatch
  (`${{ vars.QA_SIGNOFF_AUDIT_RUNNER || 'ubuntu-latest' }}`); this decision activates it.
- **Rationale:** Four options were on the table (this doc records the one chosen and the one rejected):
  1. **Self-hosted runner (CHOSEN).** Register an Actions runner on the host that has the board,
     set `QA_SIGNOFF_AUDIT_RUNNER` to its label, and the existing workflow picks it up with zero
     file change. Cost: one runner to operate/secure. Benefit: the board never leaves the trusted
     host, the audit runs against the **real** board every Monday, and the workflow as shipped works
     without modification.
  2. **Publish a board snapshot (REJECTED).** An exporter writes the board (or a redacted export) to
     a location the runner fetches, and the job passes it via `board_db`. Rejected because the repo
     is **public** (`zeldadil/password-manager`, `allow_forking: true`), and the board rows carry
     card titles, bodies, comments, evidence paths and assignees — material that must not leave the
     trusted host in anything sufficient to run a real audit. A redacted export sufficient for a
     working audit would still surface card identity + structure, and writing any export is a
     "what may leave the host" rule that is out of scope for this transport decision and not worth
     opening. If a future need genuinely requires a CI-visible snapshot, it becomes its own owned card
     (privacy decision first), not a silent export from this transport card.
  3. **Accept the red run (REJECTED).** Treating the workflow as dispatch-only collapses into option 1
     (a dispatch with `board_db` only works where a board exists — i.e. a self-hosted runner or a host
     with the board) or into running the audit by hand, which is today's state and fails AC5 (next
     reader must not reverse-engineer why the scheduled job is red).
  4. **Re-scope to on-demand-only (REJECTED).** Removing the schedule or deleting the workflow would
     leave `QA_SIGN_OFF_GATE.md` §2 / §10 and `docs/` implying a weekly audit runs; the open item
     would then have to be closed as "on-demand audit only, by decision", which is a different decision
     than the one the CI-001h card already took (a scheduled audit was wanted and the workflow was
     built and verified for it). Not taken.
- **What actually happens now:** The repository variable `QA_SIGNOFF_AUDIT_RUNNER` is set to the
  self-hosted runner label. The Monday 06:17 UTC schedule now resolves to that runner, which has
  `node >= 22`, `sqlite3`, and the checked-out repo with `scripts/qa/signoff-gate.mjs` present, and
  the board at `~/.hermes/kanban.db`. The audit runs against the real board; the run is the evidence.
- **Owner:** `architect` (this card) for the runner registration + variable + decision doc; `qa` owns
  the audit outcome interpretation (the gate script and the verdict semantics are `qa`'s).
- **References:** `.github/workflows/qa-signoff-audit.yml` header comment (board transport order +
  `QA_SIGNOFF_AUDIT_RUNNER` escape hatch); `QA_SIGN_OFF_GATE.md` §2 (detection layer), §6 (board
  resolution), §10 open item 1; `docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md` (CI wiring
  decision that deferred the CI audit to a follow-up — this card is that follow-up landing); PR #16
  (`feature/t_430aa9a3`, gate script + `QA_SIGN_OFF_GATE.md`), PR #17 (`feature/t_ea0783c5`,
  `qa-signoff-audit.yml`).

### Privacy outcome for the rejected option 2

- **Outcome:** Option 2 (publish a board snapshot) is **not** chosen and **not** implemented. The repo
  is public and the board contains card titles, bodies, comments, evidence paths and assignees; no
  export sufficient to run a working audit may leave the host under this decision. Any future
  CI-visible snapshot would require its own explicit "what may leave the host" decision recorded by
  `architect` + `qa` before anything is written, and is out of scope here.
- **References:** `PROJECT_BRIEF.md` (repo is public); this card's board privacy scan (card title/body/
  comment/evidence columns present in `tasks` table of `~/.hermes/kanban.db`).

### Merge order note (from the parent card, re-stated for the next reader)

- PR #17 (`feature/t_ea0783c5`, this workflow) calls `scripts/qa/signoff-gate.mjs`, which ships with
  **PR #16** (`feature/t_430aa9a3`). Land #16 first or together with this card, otherwise the job
  fails at its "Verify the gate script is present" step with an explicit error. This card's branch is
  based on `feature/t_430aa9a3` so the gate script is present; that ordering is preserved when these
  land.
