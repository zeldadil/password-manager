#!/usr/bin/env python3
"""Summarise a `signoff-gate.mjs check --json` result: exit code, violations, advisory counts, operative verdict."""
import json, sys, collections
d = json.load(open(sys.argv[1]))
r = d["results"][0] if "results" in d else d
f = r.get("facts", {})
print(f"card={f.get('task_id')} status={f.get('status')} gate_exit={sys.argv[2]}")
print(f"violations={sorted({v['rule'] for v in r['violations']})}")
c = collections.Counter(a["rule"] for a in r["advisories"])
print("advisories=" + ", ".join(f"{k}x{v}" for k, v in sorted(c.items())))
for k in ("verdict", "verdict_token", "operative_verdict", "verdict_source"):
    if k in f:
        print(f"{k}={f[k]}")
