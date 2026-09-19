#!/usr/bin/env python3
"""t_d20787de — classify every token-shaped string found on remote branch tips.

Never prints a value: only ref, path, count, sha256 classification and, for unknown values,
a live provider probe verdict (getMe 200 / 401). Classification fingerprints:
  DEAD            62fe6fe5...  (revoked at @BotFather, getMe 401)
  ROTATED-LIVE    df5ccd96...  (the value propagated by t_28951254, later rotated again)
  CURRENT-LIVE    the value in the 7 profiles' .env today (getMe 200)
  SYNTHETIC       a placeholder that is not a live credential (getMe 401)
"""
import hashlib
import json
import re
import subprocess
import urllib.error
import urllib.request

REPO = "/home/sap/password-manager-check"
DEAD = "62fe6fe5053a50ec0570f5845ccd0ad39ea048c24239ae677c8eaa9a082e4aff"
ROTATED = "df5ccd96d61f23a350efd8b3cb1e84b33ee552660446b167e07085e7baacadd2"
TOKPAT = re.compile(r"[0-9]{8,12}:[A-Za-z0-9_-]{35}")


def sha(v):
    return hashlib.sha256(v.encode()).hexdigest()


def name(fp):
    if fp == DEAD:
        return "DEAD"
    if fp == ROTATED:
        return "ROTATED-LIVE(t_28951254)"
    if fp == CURRENT:
        return "CURRENT-LIVE(.env today)"
    return "OTHER(" + fp[:8] + "…)"


def getme(tok):
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/getMe", timeout=20) as r:
            b = json.loads(r.read().decode())
        return 200 if b.get("ok") else r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:  # noqa: BLE001
        return -1


def sh(cmd):
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True).stdout


# current live value (from qa's own .env) — never printed
env = open("/home/sap/.hermes/profiles/qa/.env", errors="replace").read()
m = TOKPAT.search(env)
CURRENT = sha(m.group(0)) if m else ""

print("current profile .env value fingerprint classification:", name(CURRENT) if CURRENT else "NONE")
print("live probe of the current .env value:", "getMe HTTP", getme(m.group(0)) if m else "n/a")
print()

tips = [r for r in sh(["git", "for-each-ref", "--format=%(refname)", "refs/remotes/origin"]).splitlines() if "HEAD" not in r]
print(f"scanning {len(tips)} remote-tracking branch tips")
print()

found = {}
for ref in tips:
    files = sh(["git", "grep", "-l", "-E", TOKPAT.pattern, ref]).splitlines()
    for line in files:
        refname, path = line.split(":", 1)
        blob = subprocess.run(["git", "show", f"{refname}:{path}"], cwd=REPO, capture_output=True, text=True).stdout
        for tok in TOKPAT.findall(blob):
            found.setdefault(tok, set()).add(f"{refname}:{path}")

print(f"distinct token-shaped values on tips: {len(found)}")
for tok, where in sorted(found.items(), key=lambda kv: -len(kv[1])):
    print(f"  value len={len(tok)} fingerprint={name(sha(tok)):<28} occurrences={len(where)}")
    for w in sorted(where)[:15]:
        print(f"      {w}")
    if len(where) > 15:
        print(f"      … {len(where)-15} more")
    if name(sha(tok)).startswith("OTHER"):
        print(f"      live probe: getMe HTTP {getme(tok)}")
print()
print("NOTE: no token value is printed anywhere in this transcript.")
