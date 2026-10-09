# t_b2588ee7 — a `qa-signoff-exception` can be withdrawn

Card: `t_b2588ee7` (child of `t_b8001b55`). Branch `qa/t_b2588ee7-withdrawal-v2`, based on `origin/master` @ `6d0d3ac`.

## Defect

`findException` kept the **first** applied exception (`if (!exception) exception = …`, formerly `.find()`) and no
record could end it. An exception recorded in error was permanent — the one irrevocable object of the gate, where
everything else is corrected by a newer comment (comments are never edited or deleted).

Second, latent defect found while writing the RED cases: `EXCEPTION_RE` matched
`qa-signoff-exception-withdrawn: …` and `qa-signoff-exception: withdrawn — …` and turned them into an **exception**
whose reason was "withdrawn…" — a withdrawal attempt became a waiver (see `selftest-red.txt`, the two
"withdrawal spelling" cases: `exc={"reason":"withdrawn: no longer needed", …}` with `X1_EXCEPTION`).

## Choice: explicit key, not "last occurrence wins" (acceptance criterion 1)

`qa-signoff-exception withdrawn: <reason>`. Justified in the `findException` doc comment
(`scripts/qa/signoff-gate.mjs`) and in `QA_SIGN_OFF_GATE.md` §5.6:

- "last wins" cannot express *no exception* — it can only swap one waiver for another, so it would still need a
  sentinel value (an explicit key in disguise);
- "last wins" would silently change the operative reason on cards already carrying several keys; the explicit key
  changes nothing on a card that never records one (measured below: 0 changes);
- a withdrawal is its own audit event (author, reason, `X2_EXCEPTION_WITHDRAWN`).

No existing comment is edited or deleted; a withdrawal is a new comment.

## Acceptance criteria → selftest cases (section 1g of `selftest-green.txt`)

| AC | Case(s) |
|---|---|
| 1 exception then withdrawal → no exception | `(1)` same author (architect→architect), other allowed author (dashboard→qa): R1 + R4 fire, X2 reported, no X1; hook mode blocks completion |
| 2 same author constraints as recording | `(2)` withdrawal by `backend` and by `worker` → refused (A16 author), exception holds (X1, 0 violations); withdrawal key only in a code span → refused (A16 quoted) |
| 3 withdrawal without prior exception → no effect, no crash | `(3)` bare card: JSON produced, R1 as on a bare card, A16 no-exception; compliant card + stray withdrawal → 0 violations; withdrawal posted *before* the exception does not pre-empt it |
| extra | re-arm (exception → withdrawal → new exception), exception + withdrawal in one comment, same-second tie broken by comment id (`ORDER BY created_at, id`), the two withdrawal spellings are never exceptions, security-track card (exception refused → withdrawal no-op, R7 + R1 still fire) |

## Runs (Node v22.23.3, the CI version)

- `selftest-green.txt` — branch gate + branch selftest: **188/188**.
- `selftest-red.txt` — **master** gate (`6d0d3ac`, sha256 `8e3e648c…005c43e`) + branch selftest: **172/188**; the
  16 failures are exactly the 16 new `1g` cases, all 172 earlier cases pass.
- `ab-live-board.txt` — `ab-live-board.sh` + `ab-compare.py`: `audit --no-github` with the master gate and with the
  branch gate (sha256 `f0f2abcb…05b97865`) on one `sqlite3 .backup` snapshot of the live board (sha256
  `08b7f811…6479a8e04`, not committed): 142 done cards, **0 violation-set, 0 advisory-set, 0 operative-exception
  changes**; same counts on both sides. The only live comment mentioning an exception withdrawal (`t_75180b28` #552)
  describes this defect in prose and does not match the key.

The 9 `A11` cards in that run are the expected effect of `--no-github`, identical on both sides.

## Not done here

- No withdrawal was posted on any live card. The `t_75180b28` exception cited by the card was born from a backtick
  quotation and is already refused (`A10_EXCEPTION_IGNORED`) since `t_b8001b55`; it needs no withdrawal.
- The audit "bypasses & degradations" block (`t_5b5b61e2`) does not count `X2`/`A16` yet; noted on that card.
