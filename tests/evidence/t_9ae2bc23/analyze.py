#!/usr/bin/env python3
"""t_9ae2bc23 — per-card diff of the sign-off gate audits produced by sweep.sh.
Usage: analyze.py <outdir> <board-snapshot.db>"""
import json, os, re, sqlite3, sys

out, db = sys.argv[1], sys.argv[2]

def load(name):
    p = os.path.join(out, name)
    with open(p) as f:
        d = json.load(f)
    return d, {r["facts"]["task_id"]: r for r in d["results"]}

def rules(r, key="violations"):
    return sorted({x["rule"] for x in r[key]}) if r else None

def a10(r):
    return [x["detail"] for x in r["advisories"] if x["rule"] == "A10_EXCEPTION_IGNORED"] if r else []

def x1(r):
    return [x["detail"] for x in r["advisories"] if x["rule"] == "X1_EXCEPTION"] if r else []

def why(detail):
    if "code span" in detail: return "quoted"
    if "allowed author" in detail: return "author"
    if "security-track" in detail: return "security-track"
    return "?"

def diff(a, b, la, lb):
    ids = sorted(set(a) | set(b))
    newly, cleared, changed, same = [], [], [], 0
    for t in ids:
        va, vb = rules(a.get(t)), rules(b.get(t))
        if va == vb: same += 1; continue
        if not va and vb: newly.append(t)
        elif va and not vb: cleared.append(t)
        else: changed.append(t)
    print(f"  {la} -> {lb}: cards={len(ids)} unchanged={same} newly_failing={newly} cleared={cleared} changed={changed}")
    for t in newly + cleared + changed:
        print(f"      {t}: {la}={rules(a.get(t))} {lb}={rules(b.get(t))}")
    return newly, cleared, changed

key_cards = set()
for view in ("default", "strict"):
    do, old = load(f"audit-old-{view}.json")
    df, fix = load(f"audit-fix-{view}.json")
    dh, head = load(f"audit-head-{view}.json")
    print(f"=== view={view}")
    print(f"  counts old={do['counts']}\n  counts fix={df['counts']}\n  counts head={dh['counts']}")
    diff(old, fix, "old", "fix")
    diff(fix, head, "fix", "head")
    print("  -- every card with an exception record (old X1 / fix,head A10 or X1):")
    for t in sorted(set(old) | set(fix) | set(head)):
        o, f, h = old.get(t), fix.get(t), head.get(t)
        if not (x1(o) or a10(f) or x1(f) or a10(h) or x1(h)):
            continue
        key_cards.add(t)
        facts = (h or f)["facts"]
        relied = bool(a10(f) and rules(f) and not rules(o))
        print(f"    {t} assignee={facts['assignee']} post_epoch={facts['post_epoch']} sec={facts.get('security_track')}")
        print(f"       old : viol={rules(o)} X1={len(x1(o))}")
        print(f"       fix : viol={rules(f)} X1={len(x1(f))} A10={[why(d) for d in a10(f)]}")
        print(f"       head: viol={rules(h)} X1={len(x1(h))} A10={[why(d) for d in a10(h)]}")
        print(f"       -> passed ONLY on a refused exception (old clean, fix fails, A10 present): {relied}")
    print()

print("=== counterfactual (every exception key neutralised in a copy), strict-history view")
for g in ("fix", "head"):
    _, base = load(f"audit-{g}-strict.json")
    _, noexc = load(f"audit-{g}-strict-noexc.json")
    dep = [t for t in sorted(base) if rules(base[t]) != rules(noexc.get(t))]
    print(f"  gate={g}: cards whose outcome changes without exceptions = {len(dep)}")
    for t in dep:
        print(f"    {t}: with={rules(base[t])} without={rules(noexc.get(t))} applied_X1={x1(base[t])}")
print()

print("=== every comment carrying the key on a DONE card (gate EXCEPTION_RE shape), for intent review")
KEY = re.compile(r"qa[\s_-]*signoff[\s_-]*exception", re.I)
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
q = """SELECT c.task_id, c.id, c.author, c.created_at, c.body FROM task_comments c JOIN tasks t ON t.id=c.task_id
       WHERE t.status='done' ORDER BY c.task_id, c.id"""
n = 0
for tid, cid, author, ts, body in con.execute(q):
    if not body: continue
    for m in KEY.finditer(body):
        n += 1
        i = m.start()
        ex = body[max(0, i - 110): i + 150].replace("\n", " ")
        print(f"  {tid} #{cid} author={author}: ...{ex}...")
print(f"  total key occurrences on done cards: {n}; distinct cards: {len(set(r[0] for r in con.execute(q) if r[4] and KEY.search(r[4])))}")
