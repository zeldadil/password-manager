#!/usr/bin/env python3
"""t_9ae2bc23 — neutralise every exception key in a board COPY (never the live board).
Uses the gate's own key shape (EXCEPTION_RE, signoff-gate.mjs): qa[\\s_-]*signoff[\\s_-]*exception
Usage: neutralise.py <copy.db>  -> prints rows changed and rows still matching."""
import re, sqlite3, sys

KEY = re.compile(r"(qa[\s_-]*signoff[\s_-]*)exception", re.I)
GATE_RE = re.compile(r"qa[\s_-]*signoff[\s_-]*exception\s*[:\-—]+\s*(\S[^\n]*)", re.I)
db = sys.argv[1]
import os
if os.path.basename(db) == "kanban.db":
    sys.exit("refusing to write what looks like the live board")
con = sqlite3.connect(db)
rows = con.execute("SELECT id, body FROM task_comments").fetchall()
changed = 0
for cid, body in rows:
    if body and KEY.search(body):
        con.execute("UPDATE task_comments SET body=? WHERE id=?", (KEY.sub(r"\1NEUTRALISED", body), cid))
        changed += 1
con.commit()
left = sum(1 for (_, b) in con.execute("SELECT id, body FROM task_comments") if b and GATE_RE.search(b))
print(f"neutralised comments: {changed}; comments still matching EXCEPTION_RE: {left}")
