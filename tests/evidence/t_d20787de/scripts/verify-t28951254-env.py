#!/usr/bin/env python3
"""t_d20787de — retro-verify AC1/AC2/AC3 of card t_28951254 (rotated Telegram token propagated
to all 7 profiles' .env) WITHOUT ever printing, logging or committing a secret value.

Emits: per-profile active-line count, whether the value hash-matches the rotated fingerprint
(first 12 hex chars only), whether it matches the dead fingerprint, and a live getMe probe.

The token value is read into memory only. Nothing here is written to disk.
"""
import hashlib
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROFILES = ["architect", "backend", "browser", "docs", "frontend", "product", "qa"]
ROTATED = "df5ccd96d61f23a350efd8b3cb1e84b33ee552660446b167e07085e7baacadd2"  # rotated (live) fingerprint
DEAD = "62fe6fe5053a50ec0570f5845ccd0ad39ea048c24239ae677c8eaa9a082e4aff"     # revoked (dead) fingerprint
BOARD = "/home/sap/.hermes/kanban.db"
TOKEN_RE = re.compile(r"^([0-9]{8,12}):([A-Za-z0-9_-]{35})$")


def h(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()


def fingerprint(v: str) -> str:
    d = h(v)
    if d == ROTATED:
        return "MATCH-ROTATED"
    if d == DEAD:
        return "MATCH-DEAD"
    return "OTHER(" + d[:8] + "…)"


def uncommented_values(text: str):
    """TELEGRAM_BOT_TOKEN lines that are not commented out."""
    out = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#"):
            continue
        m = re.match(r"^TELEGRAM_BOT_TOKEN\s*=\s*(.*)$", s)
        if m:
            out.append(m.group(1).strip().strip('"').strip("'"))
    return out


def main() -> int:
    print("== AC1/AC2: per-profile .env TELEGRAM_BOT_TOKEN ==")
    print("(value never printed; only line count + fingerprint classification)")
    rows = []
    for p in PROFILES:
        env = Path.home() / ".hermes" / "profiles" / p / ".env"
        if not env.exists():
            print(f"  {p:<10} .env MISSING")
            rows.append((p, "missing", 0, "-"))
            continue
        vals = uncommented_values(env.read_text(errors="replace"))
        classes = [fingerprint(v) for v in vals if v]
        print(f"  {p:<10} file={env} active_token_lines={len(vals)} fingerprint={classes if classes else '-'}")
        rows.append((p, "ok", len(vals), ",".join(classes)))
    print()

    print("== AC2: literal token-shaped values outside .env (config.yaml etc.) ==")
    for p in PROFILES:
        cfg = Path.home() / ".hermes" / "profiles" / p / "config.yaml"
        if not cfg.exists():
            print(f"  {p:<10} config.yaml MISSING")
            continue
        hits = [fingerprint(m.group(0)) for m in TOKEN_RE.finditer(cfg.read_text(errors="replace"))]
        print(f"  {p:<10} config.yaml token_shaped_hits={len(hits)} {hits if hits else ''}")
    print()

    print("== AC1: author .env (the card says all 7 profiles) ==")
    print()

    qa_env = Path.home() / ".hermes" / "profiles" / "qa" / ".env"
    vals = [v for v in uncommented_values(qa_env.read_text(errors="replace")) if v]
    if not vals:
        print("AC3 cannot be probed: qa .env carries no active token")
        return 1
    qa_val = vals[0]
    print("== AC3: live probes with the qa .env value (no value printed) ==")
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{qa_val}/getMe", timeout=20) as r:
            body = json.loads(r.read().decode())
        print(f"  getMe      HTTP {r.status} ok={body.get('ok')} bot=@{body.get('result', {}).get('username')} id={body.get('result', {}).get('id')}")
    except urllib.error.HTTPError as e:
        print(f"  getMe      HTTP {e.code} (UNAUTHORIZED/INVALID → the value is not live)")
    except Exception as e:  # noqa: BLE001
        print(f"  getMe      ERROR {type(e).__name__}: {e}")

    # source-of-truth comparison: newest dashboard comment on t_0af5aa3e
    con = sqlite3.connect(f"file:{BOARD}?mode=ro", uri=True)
    cur = con.execute(
        "SELECT body FROM task_comments WHERE task_id='t_0af5aa3e' AND author='dashboard' ORDER BY created_at DESC, id DESC LIMIT 1"
    )
    row = cur.fetchone()
    con.close()
    if row:
        m = TOKEN_RE.search(row[0] or "")
        print(f"  board ref  newest dashboard comment on t_0af5aa3e contains a token-shaped value: {bool(m)}")
        if m:
            print(f"  compare    qa .env value vs board value → {'IDENTICAL' if m.group(0) == qa_val else 'DIFFERENT'} "
                  f"(board fingerprint={fingerprint(m.group(0))})")
    else:
        print("  board ref  no dashboard comment on t_0af5aa3e")

    print()
    print("== summary ==")
    bad = [p for (p, st, n, cls) in rows if n != 1 or "MATCH-ROTATED" not in cls]
    print(f"  profiles with exactly 1 active token line matching the rotated fingerprint: {7 - len(bad)}/7")
    if bad:
        print(f"  NOT matching: {bad}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
