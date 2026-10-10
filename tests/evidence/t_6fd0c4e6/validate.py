#!/usr/bin/env python3
"""t_6fd0c4e6 - doc-validation for README.md (t_325bea72 ACs 2 and 4, plus mermaid fence shape).
Usage: validate.py <README.md>   exit 0 = pass, 1 = fail
"""
import re, subprocess, sys, tempfile, os

REQUIRED = ["Project Overview", "Architecture Diagram", "Prerequisites", "Quick Start"]
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
lines = text.split("\n")
fails = []

# --- fenced blocks (respect fences when collecting headings) ---
blocks, in_fence, fence, lang, buf, start = [], False, "", "", [], 0
h2 = []
for i, l in enumerate(lines, 1):
    m = re.match(r"^(\s*)(`{3,}|~{3,})(.*)$", l)
    if not in_fence and m:
        in_fence, fence, lang, buf, start = True, m.group(2), m.group(3).strip(), [], i
        continue
    if in_fence and m and m.group(2).startswith(fence[0]) and len(m.group(2)) >= len(fence) and not m.group(3).strip():
        blocks.append((lang, start, i, "\n".join(buf)))
        in_fence = False
        continue
    if in_fence:
        buf.append(l)
    elif l.startswith("## "):
        h2.append((i, l[3:].strip()))
if in_fence:
    fails.append(f"unterminated fence opened at line {start}")

print("H2 headings (outside fences):")
for i, h in h2:
    print(f"  l.{i}: {h}")
names = [h for _, h in h2]
# AC2: the four required sections present, in order, and they are the FIRST four H2s
if names[:4] != REQUIRED:
    fails.append(f"AC2: first four H2 are {names[:4]}, expected {REQUIRED}")
else:
    print("AC2 PASS: four required sections are the first four H2, in order")
extra = names[4:]
print(f"  sections after the four required: {extra}")

# section span helper
def section(name):
    idx = [k for k, (_, h) in enumerate(h2) if h == name]
    if not idx:
        return None
    k = idx[0]
    s = h2[k][0]
    e = h2[k + 1][0] if k + 1 < len(h2) else len(lines) + 1
    return s, e

# Mermaid: exactly one ```mermaid block, inside Architecture Diagram
mer = [b for b in blocks if b[0] == "mermaid"]
arch = section("Architecture Diagram")
print(f"mermaid blocks: {[(b[1], b[2]) for b in mer]}")
if len(mer) != 1:
    fails.append(f"AC3-shape: expected 1 mermaid block, found {len(mer)}")
elif not (arch and arch[0] < mer[0][1] < arch[1]):
    fails.append("AC3-shape: mermaid block not inside Architecture Diagram section")
else:
    body = mer[0][3]
    first = body.strip().split("\n")[0].strip()
    if not re.match(r"^(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b", first):
        fails.append(f"AC3-shape: unexpected diagram header: {first!r}")
    if any(ord(c) > 0x7e and c not in "\u2192\u2014\u2013\u00b7\u2026" for c in body):
        bad = sorted({hex(ord(c)) for c in body if ord(c) > 0x7e})
        print(f"  note: non-ASCII code points in mermaid body: {bad}")
    if body.count('"') % 2:
        fails.append("AC3-shape: odd number of double quotes in mermaid body")
    print(f"  mermaid header: {first}; {len(body.splitlines())} lines")
    with open(os.environ.get("MERMAID_OUT", "/dev/null"), "w") as f:
        f.write(body + "\n")

# AC4: bash -n on every bash/sh block in Quick Start
qs = section("Quick Start")
qblocks = [b for b in blocks if qs and qs[0] < b[1] < qs[1]]
print(f"Quick Start fenced blocks: {[(b[0], b[1], b[2]) for b in qblocks]}")
nb = 0
for lang_, s, e, body in qblocks:
    if lang_ not in ("bash", "sh", "shell"):
        continue
    nb += 1
    with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as t:
        t.write(body + "\n")
    r = subprocess.run(["bash", "-n", t.name], capture_output=True, text=True)
    os.unlink(t.name)
    status = "ok" if r.returncode == 0 else "FAIL"
    print(f"  bash -n block l.{s}-{e} ({len(body.splitlines())} lines): {status} rc={r.returncode} {r.stderr.strip()}")
    if r.returncode != 0:
        fails.append(f"AC4: bash -n failed for block l.{s}-{e}")
if nb == 0:
    fails.append("AC4: no bash blocks in Quick Start")

print()
if fails:
    print("RESULT: FAIL")
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("RESULT: PASS")
