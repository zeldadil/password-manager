
# QA verdict — t_0af5aa3e · P0 leaked Telegram bot token (public git history)

**QA-VERDICT: pass-with-conditions** — verifier: `qa` profile · verified 2026-09-17T20:14–20:20Z
**Repo:** `https://github.com/zeldadil/password-manager` (public) · `master` @ `eb6044b` · **31 public branches** (was 28)
**Method:** fresh `git clone --mirror` of the public repo + full-history scans + live `getMe` probes + live CI re-run.

> **No credential value appears in this document.** The leaked value is referred to by
> `sha256=62fe6fe5053a50ec0570f5845ccd0ad39ea048c24239ae677c8eaa9a082e4aff` (46 chars, "the old value").
> The rotated value is referred to only through its Telegram identity (`@AASLlmHermesBot`, bot id `<BOT_ID_REDACTED>`) and is not
> fingerprinted here either — it is a live credential.
