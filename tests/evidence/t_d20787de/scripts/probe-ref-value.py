#!/usr/bin/env python3
"""t_d20787de — liveness probe for the value embedded in a public branch tip (fingerprint only).
Usage: probe-ref-value.py <ref> <path>
Prints: fingerprint classification + getMe HTTP code. Never the value.
"""
import hashlib
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request

REPO = "/home/sap/password-manager-check"
TOKPAT = re.compile(r"[0-9]{8,12}:[A-Za-z0-9_-]{35}")
FPS = {
    "62fe6fe5053a50ec0570f5845ccd0ad39ea048c24239ae677c8eaa9a082e4aff": "DEAD (revoked)",
    "df5ccd96d61f23a350efd8b3cb1e84b33ee552660446b167e07085e7baacadd2": "ROTATED (t_28951254 value)",
}

ref, path = sys.argv[1], sys.argv[2]
blob = subprocess.run(["git", "show", f"{ref}:{path}"], cwd=REPO, capture_output=True, text=True).stdout
toks = set(TOKPAT.findall(blob))
print(f"ref:  {ref}")
print(f"path: {path}")
print(f"distinct token-shaped values in blob: {len(toks)}")
for tok in toks:
    fp = hashlib.sha256(tok.encode()).hexdigest()
    label = FPS.get(fp, "OTHER(" + fp[:8] + "…)")
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/getMe", timeout=20) as r:
            b = json.loads(r.read().decode())
        code = 200 if b.get("ok") else r.status
        detail = f"ok={b.get('ok')} bot=@{b.get('result', {}).get('username')}"
    except urllib.error.HTTPError as e:
        code, detail = e.code, "invalid/revoked"
    except Exception as e:  # noqa: BLE001
        code, detail = -1, type(e).__name__
    print(f"  fingerprint={label:<30} getMe HTTP {code} {detail}")
    if code == 200:
        print("  → LIVE CREDENTIAL EXPOSED ON A PUBLIC BRANCH TIP")
