import json
W = "/home/sap/.hermes/kanban/workspaces/t_b2588ee7/"
a = json.load(open(W + "audit-master.json"))
b = json.load(open(W + "audit-branch.json"))
print("keys:", list(a.keys())[:20])
def cards(d):
    r = d["results"]
    out = {}
    for c in r:
        tid = c.get("task_id") or c.get("id") or (c.get("facts") or {}).get("task_id") or (c.get("facts") or {}).get("id")
        out[tid] = c
    return out
print("sample result keys:", list(a["results"][0].keys()))
ca, cb = cards(a), cards(b)
print("cards master/branch:", len(ca), len(cb))
def rules(c, key):
    return sorted({(x.get("rule") if isinstance(x, dict) else x) for x in c.get(key, [])})
vio_changes = adv_changes = 0
for tid in sorted(set(ca) | set(cb)):
    x, y = ca.get(tid, {}), cb.get(tid, {})
    if rules(x, "violations") != rules(y, "violations"):
        vio_changes += 1; print("VIOLATION DELTA", tid, rules(x, "violations"), rules(y, "violations"))
    if rules(x, "advisories") != rules(y, "advisories"):
        adv_changes += 1; print("ADVISORY DELTA", tid, rules(x, "advisories"), rules(y, "advisories"))
    ex, ey = (x.get("facts") or {}).get("exception"), (y.get("facts") or {}).get("exception")
    if ex != ey:
        print("EXCEPTION DELTA", tid, ex, ey)
print("violation-set changes:", vio_changes, "advisory-set changes:", adv_changes)
xs = [t for t, c in cb.items() if "X1_EXCEPTION" in rules(c, "advisories")]
print("cards with applied X1 on branch:", xs)
print("ok master/branch:", a.get("ok"), b.get("ok"), "counts:", a.get("counts"), b.get("counts"))
