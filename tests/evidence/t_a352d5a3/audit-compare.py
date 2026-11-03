import json
d = "<audit dir>/"
def load(side):
    j = json.load(open(d + f"audit-{side}.json"))
    return j, {r["facts"]["task_id"]: r for r in j["results"]}
jm, m = load("master")
jb, b = load("branch")
print("counts master:", jm["counts"])
print("counts branch:", jb["counts"])
rules = lambda r: sorted({v["rule"] for v in r.get("violations", [])})
inv = lambda r: [x.get("token") if isinstance(x, dict) else x for x in (r["facts"].get("invalid_verdicts") or [])]
changed = []
for tid in sorted(set(m) | set(b)):
    a, c = m.get(tid), b.get(tid)
    if not a or not c:
        changed.append((tid, "missing on one side", "", "")); continue
    va, vc = a["facts"].get("verdict"), c["facts"].get("verdict")
    if va != vc or rules(a) != rules(c) or inv(a) != inv(c):
        changed.append((tid, f"verdict {va} -> {vc}", f"rules {rules(a)} -> {rules(c)}", f"invalid {inv(a)} -> {inv(c)}"))
print(f"cards: {len(m)} / {len(b)}; changed: {len(changed)}")
for x in changed: print("  " + " | ".join(x))
lost = [x for x in changed if x[1].startswith("verdict pass ->") or x[1].startswith("verdict pass-with-conditions ->")]
print("cards that LOSE a pass / pass-with-conditions:", len(lost))
