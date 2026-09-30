# Lessons learned → generic agent rules

One entry per incident that produced a standing rule in an agent profile's
`SOUL.md` (`~/.hermes/profiles/<name>/SOUL.md`). The rules themselves are
kept project-agnostic — this file is where the project-specific history
that justified each one lives, so it isn't lost and isn't diluting a
persona file meant to be reused on other projects.

---

## 2026-09-18 to 2026-09-20 — merge-sweep incident and post-sweep audit

### 1. Pushed branches with no PR, invisible for days

5 backend tasks (BE-001a: DB Migration System, BE-001b: Core Tables Schema,
BE-001c: API Skeleton + OpenAPI + Health Endpoint, BE-001d: Envelope
Middleware, BE-001f: Error Handler + Secret Scanning CI) were each marked
`done` while their branch was pushed but no Pull Request was ever opened.
The work sat invisible and unmerged on `master` for over two days,
discovered only by a manual cross-check between the Kanban board and
`master` during the 18–20 Sept 2026 merge-sweep session. All five were
later opened and merged as PRs #40–#44.

**Rule produced:** "A pushed branch is not done; open and track the PR" —
added to `architect`, `backend`, `browser`, `docs`, `frontend`, `product`.

### 2. 11+ PRs unmerged, no periodic check existed

Beyond the 5 backend tasks above, a broader pattern emerged during the same
session: 11+ PRs across backend and QA work sat unmerged, or in 5 cases were
never even opened, for two or more days. Normal workflow gave no signal on
its own — nothing prompted anyone to check.

**Rule produced:** "No PR left unmerged; periodic coherence audit" —
`architect` now runs a coherence check (list every open PR, list every
`done` task with a code deliverable, cross-check both landed on `master`)
at least once per work day or every 10 tasks marked `done`.

### 3. A "done" decision whose owning task never actually shipped the code

A scope decision assigned a UI feature (a theme toggle, task FE-001d) to an
owning task. Both the decision and the owning task were marked `done`/
merged, but no code anywhere in the app actually wired the feature — the
gap was self-documented in a test file's comment and never surfaced to
anyone until an unrelated audit found it.

**Rule produced:** "A scope/process decision is not closed until its
owning task's code exists" — `architect` must verify by reading/grepping
the actual merged code, not by trusting the owning task's own completion
claim.

### 4. A false "purge complete" claim, and a PR merged without its claimed fix

Two separate incidents converged on the same lesson: (a) during remediation
of a security incident (a Telegram bot token exposed in the repo, 18–19
Sept 2026), a "purge complete, 0 findings" claim was verified only against
rewritten local git refs — not the actual remote — giving a false all-clear.
(b) Separately, task `t_710ed14c`'s PR was merged without actually
containing the code-fix change its own PR description claimed.

**Rule produced:** "Verify independently before accepting any done/pass
claim, including your own past verdicts" — `qa` always re-checks from a
fresh source: a fresh `git clone --mirror` for git-history claims, the
actual merged file content for code-fix claims, live re-execution for
test/CI-green claims.

### 5. Four gate-defect cards discovered mid-review, never consolidated

While reviewing one card, QA discovered a defect in the shared QA
sign-off-gate tooling. Fixing it led to discovering another defect in the
same tooling mid-review, which led to another, then another — four
separate cards in a chain, each opened reflexively at the moment of
discovery, never consolidated, making merge order and tracking far more
complex than necessary.

**Rule produced:** "Consolidate gate-defect discoveries; don't spawn a new
card by reflex" — `qa` documents a shared-infrastructure defect as a
comment on the card being reviewed first; a dedicated card is opened only
once `architect` (or `qa`, explicitly) judges it warrants one.

### 6. A branch deletion made evidence for two closed cards unreachable

During post-incident cleanup after the Telegram token exposure, a branch
tied to the incident was deleted. Three commits on it were cited as
verification evidence by two already-closed Kanban cards, and briefly
became unreachable as a result.

**Rule produced:** "Git safety on security-incident branches" — `architect`
and `qa` must check whether an already-closed card cites a given branch
name or commit hash as its evidence before deleting or rewriting it; never
run a history rewrite on a shared branch without explicit human
confirmation, even if a similar rewrite was already attempted and
documented as abandoned.

### 7. A bug-fix scope-boundary call, made correctly twice

`backend` correctly fixed a bug introduced by its own current change (a new
script flag that silently changed an existing tool's exit-code behavior),
and correctly deferred a separate, pre-existing, unrelated bug discovered
in the same session — filing it as a documented follow-up instead of
fixing it opportunistically. Both calls were right specifically because
they used the same distinction.

**Rule produced:** "Fixing bugs in scope only" — `backend` fixes only what
its own current change introduces; pre-existing unrelated bugs are
documented on the owning card, not fixed inline.

### 8. A real domain used in a test fixture

A test fixture used `example.com` — a real, registered domain (even though
IANA-reserved for documentation use) — and was flagged by a newly added
synthetic-data scanner.

**Rule produced:** Synthetic test-data clarification (`browser`, `frontend`
security-gate rules) — use `example.test` (RFC 2606, truly non-resolvable),
never `example.com` or any other real domain.

### 9. A credential hash committed as "evidence"

A rotated token's SHA-256 hash was committed to an evidence README as proof
of rotation, and was flagged by the secret scanner — a derived artifact of
a secret (even a hash) is still treated as a secret by scanners and by this
rule.

**Rule produced:** Evidence-file credential hygiene (`backend` security-gate
rule) — never publish a hash of a real credential in a committed evidence
file.

### 10. Documentation claimed a feature that was never implemented

`docs` documented a feature as implemented based on its owning card reading
`done`, without checking that the merged code actually matched the claim —
the same class of gap as lesson 3.

**Rule produced:** Docs "done" verification tightened — `docs` checks the
actual merged content of a card's evidence PR before documenting a feature
as implemented, not just that the card says `done`.

### 11. A claimed CI-config fix that never reached the merged file

A review-round comment described a CI-config fix as applied. On a later
audit, the described change was found to have never actually reached the
pushed/merged file — it had stayed in a local or worktree copy.

**Rule produced:** Folded into `frontend`'s "A pushed branch is not done"
rule — verify a described fix is actually present in the file about to be
handed off before claiming it's applied.

---

## 2026-09-29 to 2026-09-30 — ADR-007 decision process (vault-key client
availability)

### 12. Two sibling designs for the same protocol, produced independently

Under the same parent decision card, one card scoped a server-side rework
(a challenge/response authentication flow storing a directly-comparable
verifier server-side) and a sibling card independently designed a
key-separation construction (storing only a keyed hash of the client's
proof). Both were real, competent designs for the *same* authentication
step — discovered to be incompatible only when a human compared them side
by side. A third card was then needed just to reconcile the two into one
spec.

**Rule produced:** "Flag overlapping sibling designs, don't pick a winner"
— `architect` checks sibling cards under the same parent for overlapping
scope before diverging, and flags any overlap to the human rather than
letting two designs form independently.

### 13. A corrupted evidence attachment, and a comment pointing to a stub

One design card's evidence attachment contained garbage placeholder text
completely unrelated to its actual content (which existed intact only in
the card's comment). A sibling card had the opposite problem: its comment
said "see the full design in the comment on this card," but that comment
was only a QA-deferral stub — the actual design existed only in the card's
attachment. Both were caught by an independent reviewer, not by the
producing agent.

**Rule produced:** "Evidence must be self-consistent with what it claims"
— added to all seven profiles.

### 14. A human-only gate card auto-dispatched within a minute

A card was created with no assignee, specifically so it could never be
automatically dispatched — only a human was meant to act on it. A
default-assignee setting in the local tooling config auto-assigned it to
an agent profile and started a live run on it within about a minute of
creation. Caught before any comment was posted (the run was reclaimed and
the card was sticky-blocked), but it demonstrated that "no assignee" alone
is not a reliable way to keep a card human-only.

**Rule produced:** "If a HUMAN GATE card is auto-assigned to you, block it
and do nothing else" — added to all seven profiles. Also: "Design-card done
≠ approved; HUMAN GATE cards are off-limits" — added to `architect`,
`backend`, `frontend`, `browser` — never close, unblock, or reassign a
HUMAN GATE card, and never implement a design whose HUMAN GATE card is
still open.

### 15. Frontend tasks kept getting dispatched against an ADR's open question

An architecture decision record explicitly left a security-relevant
question open (how a client obtains key material at all), naming a future
task as the place it would be resolved. That task never resolved it.
Multiple frontend implementation tasks whose acceptance criteria assumed
the open question was already answered were dispatched anyway over the
following days, each independently discovering the same gap from scratch.

**Rule produced:** "Don't implement around an open decision record" —
added to `backend`, `frontend`, `browser` — if a decision record relevant
to your task still lists an open point, block and ask instead of picking
an interpretation yourself.

### 16. QA passed two designs that turned out to conflict with each other

Both sibling designs from lesson 12 were independently reviewed and passed
by QA. Neither review caught that the two designs specified different
server-side storage constructions for what was meant to be the same
authentication mechanism — each review checked its own card's design for
internal correctness, not for consistency with the sibling card.

**Rule produced:** "Check consistency across designs defining the same
mechanism before verdicting" — added to `qa`.

### 17. A human decision recorded by a relayed comment, not the human's own

A human's decision on a gated card was first posted through an assistant
relaying it via a generic CLI author identity, not the human's own
dashboard account. The relay was clearly labeled as such, and the human
later posted the authoritative decision themselves from the dashboard,
explicitly superseding the relayed comment — but the distinction had to be
checked and made explicit rather than assumed.

**Rule produced:** (process note only, not yet a standing SOUL.md rule —
flagged here in case a future incident makes a rule worth adding: relayed
comments on a human-decision card should always be labeled as relayed, and
the relaying agent should surface the author field back to the human for
confirmation before treating the decision as final.)
