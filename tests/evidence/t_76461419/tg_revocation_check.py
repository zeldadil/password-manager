#!/usr/bin/env python3
"""t_76461419 — revocation check of every distinct telegram-token value.

Reads the UNREDACTED gitleaks report (scratch only, never committed), keeps the
token values in memory only, calls Telegram getMe for each DISTINCT value and
prints ONLY: gitleaks fingerprint(s), sha256 prefix of the value, HTTP status
and the `ok` flag of the response. No value is printed, logged or written.
Exit 3 (and STOP) if any getMe call answers 200.
"""
import hashlib, json, sys, urllib.request, urllib.error, collections

rep = json.load(open(sys.argv[1]))
by_val = collections.OrderedDict()
for f in rep:
    if f['RuleID'] != 'telegram-token':
        continue
    by_val.setdefault(f['Secret'], []).append(f['Fingerprint'])

print(f'telegram-token findings: {sum(len(v) for v in by_val.values())}, distinct values: {len(by_val)}')
alive = 0
for val, fps in by_val.items():
    h = hashlib.sha256(val.encode()).hexdigest()[:16]
    req = urllib.request.Request('https://api.telegram.org/bot' + val + '/getMe', method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            code, ok = r.status, json.load(r).get('ok')
    except urllib.error.HTTPError as e:
        code = e.code
        try:
            ok = json.load(e).get('ok')
        except Exception:
            ok = None
    except Exception as e:  # network error: never print the URL (it holds the value)
        code, ok = 'ERR:' + type(e).__name__, None
    if code == 200:
        alive += 1
    print(f'sha256[:16]={h}  http={code}  ok={ok}  findings={len(fps)}')
    for fp in fps:
        print(f'    {fp}')
del by_val
if alive:
    print(f'STOP: {alive} value(s) answered 200 — INCIDENT, do not baseline')
    sys.exit(3)
print('RESULT: no value answered 200')
