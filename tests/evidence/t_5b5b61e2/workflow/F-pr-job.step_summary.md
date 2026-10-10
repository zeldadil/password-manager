## Bypass report — synthetic fixture board (t_5b5b61e2)

Fixture board from `scripts/qa/signoff-gate.selftest.mjs` section 10 — not the real board.

### Bypasses and degradations

Counted on every audit. A degradation is **never** a card violation; it says what this audit could not check or what was waived.
A bypass (`X1`/`X2`/`X3`) **never** fails the audit: it is listed here so it stays visible (t_5b5b61e2, QA_SIGN_OFF_GATE.md §5.10).

| type | count | fails this audit? | cards |
|---|---|---|---|
| `A11_CI_STATE_UNVERIFIABLE` — CI state unverifiable — R9/R10 not evaluated | 0 | no (`--fail-on-a11` on, count 0) | — |
| `X1_EXCEPTION` — QA sign-off exception in force (§5.6) — R1/evidence waived | 5 (6 occurrences) | never | `t_b5b60001`, `t_b5b60002`, `t_b5b60007`, `t_b5b60008`, `t_b5b60009` |
| `X2_EXCEPTION_WITHDRAWN` — QA sign-off exception withdrawn (§5.6) — history, not in force | 2 (2 occurrences) | never | `t_b5b60006`, `t_b5b60007` |
| `X3_COMPLETED_OUTSIDE_HOOK` — completed outside the completion hook (CLI / dashboard / direct board edit, §5.10) | 3 (4 occurrences) | never | `t_b5b6000a`, `t_b5b6000b`, `t_b5b6000c` |

Trend as of 2026-09-27T15:46:40.000Z (30-day windows):

| type | last 30 days | previous 30 days | direction | watch threshold (30 days) | by month |
|---|---|---|---|---|---|
| `X1_EXCEPTION` | 6 | 0 | rising | 2: **above — review** | 2026-09: 6 |
| `X2_EXCEPTION_WITHDRAWN` | 2 | 0 | rising | 2: below | 2026-09: 2 |
| `X3_COMPLETED_OUTSIDE_HOOK` | 3 | 1 | rising | 10: below | 2026-08: 1, 2026-09: 3 |

#### `X1_EXCEPTION`: 6 occurrences on 5 cards

| date | card | title | author | reason | state |
|---|---|---|---|---|---|
| 2026-09-17 15:46 UTC | `t_b5b60001` | BP-01 exception in force + a redundant one | architect | incident INC-7, verdict waived 24h | in force |
| 2026-09-17 15:46 UTC | `t_b5b60002` | BP-02 exception recorded from the dashboard | dashboard | closed by human decision, duplicate card | in force |
| 2026-09-17 15:46 UTC | `t_b5b60008` | BP-08 exception whose reason carries a secret shape | architect | \[reason withheld: matches R\_SECRET\_KEY\_VALUE\_PAIR — read it on the card\] | in force |
| 2026-09-17 15:46 UTC | `t_b5b60009` | BP-09 exception whose reason carries Markdown \| pipes | architect | see \!\[pixel\]\(https://example.invalid/p.png\) and \[link\]\(https://example.invalid\) \| col \`code\` \*em\* | in force |
| 2026-09-17 15:46 UTC | `t_b5b60001` | BP-01 exception in force + a redundant one | human | same incident, confirmed by the human | redundant — repeats the exception in force |
| 2026-09-17 15:46 UTC | `t_b5b60007` | BP-07 exception withdrawn then re-armed | human | re-approved after review | in force |

#### `X2_EXCEPTION_WITHDRAWN`: 2 occurrences on 2 cards

| date | card | title | author | reason | state |
|---|---|---|---|---|---|
| 2026-09-17 15:46 UTC | `t_b5b60006` | BP-06 exception withdrawn | architect | temporary waiver | withdrawn by qa on 2026-09-17 15:46 UTC: the incident is closed |
| 2026-09-17 15:46 UTC | `t_b5b60007` | BP-07 exception withdrawn then re-armed | architect | first waiver | withdrawn by qa on 2026-09-17 15:46 UTC: not justified |

#### `X3_COMPLETED_OUTSIDE_HOOK`: 4 occurrences on 3 cards

| date | card | title | author | reason | state |
|---|---|---|---|---|---|
| 2026-08-08 15:46 UTC | `t_b5b6000c` | BP-12 manual\_complete events \(one old, one recent\) | not recorded | old closure, before the window | manual\_complete event \(direct board edit\) · assignee frontend |
| 2026-09-17 15:47 UTC | `t_b5b6000a` | BP-10 completed from the CLI \(synthesized run\) | not recorded | approved from the terminal second line | completed outside a worker run \(CLI / dashboard\) · assignee frontend |
| 2026-09-17 15:47 UTC | `t_b5b6000b` | BP-11 completed by direct board edit \(no run\) | not recorded | closed by a human edit | completed with no run \(human\_direct\_db\_edit\) · assignee frontend |
| 2026-09-17 15:47 UTC | `t_b5b6000c` | BP-12 manual\_complete events \(one old, one recent\) | not recorded | closed as duplicate via direct SQL | manual\_complete event \(direct board edit\) · assignee frontend |

### Audit report (exit code 0 — expected 0: a bypass never fails the audit)

```text
QA sign-off gate — audit (db: <selftest-root>/board-bypass.db, epoch: 2026-09-17T15:00:00.000Z)
  enforced (done at/after epoch or pre-complete): 13  ·  pass: 13  ·  FAIL: 0
  bypasses & degradations (counted on every audit — never a card violation):
    A11 (CI state unverifiable — R9/R10 not evaluated): 0  ·  --fail-on-a11: pass
    X1 (QA sign-off exception in force (§5.6) — R1/evidence waived): 5  ·  occurrences: 6  ·  cards: t_b5b60001, t_b5b60002, t_b5b60007, t_b5b60008, t_b5b60009
        trend: last 30 days 6 (previous 30 days 0, rising)  ·  watch threshold 2/30d: ABOVE — review these bypasses (never fails the audit)  ·  by month: 2026-09: 6
        t_b5b60001  2026-09-17 15:46 UTC  architect  incident INC-7, verdict waived 24h  [in force]
        t_b5b60002  2026-09-17 15:46 UTC  dashboard  closed by human decision, duplicate card  [in force]
        t_b5b60008  2026-09-17 15:46 UTC  architect  [reason withheld: matches R_SECRET_KEY_VALUE_PAIR — read it on the card]  [in force]
        t_b5b60009  2026-09-17 15:46 UTC  architect  see ![pixel](https://example.invalid/p.png) and [link](https://example.invalid) | col `code` *em*  [in force]
        t_b5b60001  2026-09-17 15:46 UTC  human  same incident, confirmed by the human  [redundant — repeats the exception in force]
        t_b5b60007  2026-09-17 15:46 UTC  human  re-approved after review  [in force]
    X2 (QA sign-off exception withdrawn (§5.6) — history, not in force): 2  ·  occurrences: 2  ·  cards: t_b5b60006, t_b5b60007
        trend: last 30 days 2 (previous 30 days 0, rising)  ·  watch threshold 2/30d: below  ·  by month: 2026-09: 2
        t_b5b60006  2026-09-17 15:46 UTC  architect  temporary waiver  [withdrawn by qa on 2026-09-17 15:46 UTC: the incident is closed]
        t_b5b60007  2026-09-17 15:46 UTC  architect  first waiver  [withdrawn by qa on 2026-09-17 15:46 UTC: not justified]
    X3 (completed outside the completion hook (CLI / dashboard / direct board edit, §5.10)): 3  ·  occurrences: 4  ·  cards: t_b5b6000a, t_b5b6000b, t_b5b6000c
        trend: last 30 days 3 (previous 30 days 1, rising)  ·  watch threshold 10/30d: below  ·  by month: 2026-08: 1, 2026-09: 3
        t_b5b6000c  2026-08-08 15:46 UTC  not recorded  old closure, before the window  [manual_complete event (direct board edit) · assignee frontend]
        t_b5b6000a  2026-09-17 15:47 UTC  not recorded  approved from the terminal second line  [completed outside a worker run (CLI / dashboard) · assignee frontend]
        t_b5b6000b  2026-09-17 15:47 UTC  not recorded  closed by a human edit  [completed with no run (human_direct_db_edit) · assignee frontend]
        t_b5b6000c  2026-09-17 15:47 UTC  not recorded  closed as duplicate via direct SQL  [manual_complete event (direct board edit) · assignee frontend]
  ok   t_b5b60001  BP-01 exception in force + a redundant one @frontend  [X1: QA sign-off exception in force]
        warn X1_EXCEPTION: QA sign-off exception recorded by architect: incident INC-7, verdict waived 24h
  ok   t_b5b60002  BP-02 exception recorded from the dashboard @frontend  [X1: QA sign-off exception in force]
        warn X1_EXCEPTION: QA sign-off exception recorded by dashboard: closed by human decision, duplicate card
  ok   t_b5b60003  BP-03 quoted key only (A10) @frontend
        warn A10_EXCEPTION_IGNORED: a qa-signoff-exception key written by "architect" appears only inside a code span/fence — a quotation, not an exception (§5.6) — ignored
  ok   t_b5b60004  BP-04 exception by an executing profile (A10) @frontend
        warn A10_EXCEPTION_IGNORED: a qa-signoff-exception recorded by "backend" is not from an allowed author (human, dashboard, user, architect, qa) — ignored
  ok   t_b5b60005  BP-05 crypto card: exception refused (security track) @frontend
        warn A10_EXCEPTION_IGNORED: a qa-signoff-exception recorded by "architect" is not applied: this is a security-track card, where AR-6 requires Architect + QA sign-off and exceptions never waive R1/R4/R7 — ignored
  ok   t_b5b60006  BP-06 exception withdrawn @frontend  [X2: exception withdrawn (history)]
        warn X2_EXCEPTION_WITHDRAWN: QA sign-off exception recorded by architect (temporary waiver) was withdrawn by qa: the incident is closed — no longer applied
  ok   t_b5b60007  BP-07 exception withdrawn then re-armed @frontend  [X1: QA sign-off exception in force]  [X2: exception withdrawn (history)]
        warn X2_EXCEPTION_WITHDRAWN: QA sign-off exception recorded by architect (first waiver) was withdrawn by qa: not justified — no longer applied
        warn X1_EXCEPTION: QA sign-off exception recorded by human: re-approved after review
  ok   t_b5b60008  BP-08 exception whose reason carries a secret shape @frontend  [X1: QA sign-off exception in force]
        warn X1_EXCEPTION: QA sign-off exception recorded by architect: [reason withheld: matches R_SECRET_KEY_VALUE_PAIR — read it on the card]
  ok   t_b5b60009  BP-09 exception whose reason carries Markdown | pipes @frontend  [X1: QA sign-off exception in force]
        warn X1_EXCEPTION: QA sign-off exception recorded by architect: see ![pixel](https://example.invalid/p.png) and [link](https://example.invalid) | col `code` *em*
  ok   t_b5b6000a  BP-10 completed from the CLI (synthesized run) @frontend  [X3: completed outside the hook]
        warn X3_COMPLETED_OUTSIDE_HOOK: completed outside a worker run (CLI / dashboard) on 2026-09-17 15:47 UTC — actor not recorded by Hermes (assignee frontend): approved from the terminal second line
  ok   t_b5b6000b  BP-11 completed by direct board edit (no run) @frontend  [X3: completed outside the hook]
        warn X3_COMPLETED_OUTSIDE_HOOK: completed with no run (human_direct_db_edit) on 2026-09-17 15:47 UTC — actor not recorded by Hermes (assignee frontend): closed by a human edit
  ok   t_b5b6000c  BP-12 manual_complete events (one old, one recent) @frontend  [X3: completed outside the hook]
        warn X3_COMPLETED_OUTSIDE_HOOK: manual_complete event (direct board edit) on 2026-08-08 15:46 UTC — actor not recorded by Hermes (assignee frontend): old closure, before the window
        warn X3_COMPLETED_OUTSIDE_HOOK: manual_complete event (direct board edit) on 2026-09-17 15:47 UTC — actor not recorded by Hermes (assignee frontend): closed as duplicate via direct SQL
  ok   t_b5b6000d  BP-13 worker completion through the hook (control) @frontend
```
