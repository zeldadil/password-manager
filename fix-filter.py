#!/usr/bin/env python3
"""fix-filter.py — corrects corrupted git filter-branch output in PROJECT_BRIEF.md"""
import os
import re
import sys

BRIEF = "PROJECT_BRIEF.md"

if not os.path.exists(BRIEF):
    print("NO FILE")
    sys.exit(0)

with open(BRIEF, "rb") as f:
    raw = f.read()

text = raw.decode("utf-8")
original = text

# Fix 1: corrupted placeholder from botched first filter-branch pass
# The actual corrupted text has single braces: "${}TELEGRAM_BOT_TOKEN${{}}"
# where the LAST two braces are literal "{{" and "}}" in the file.
# From hex analysis: the file contains literal "${}TELEGRAM_BOT_TOKEN${}`"
old1 = "${}TELEGRAM_BOT_TOKEN${{}}"
count1 = text.count(old1)
if count1 > 0:
    text = text.replace(old1, "${REDACTED_TELEGRAM_TOKEN}")
    print(f"FIXED corrupted placeholder (occurrences: {count1})")
else:
    print("corrupted placeholder NOT found")

# Fix 2: any remaining live token (belt and suspenders)
pattern = re.compile(r"8615677595:[A-Za-z0-9_]+")
matches = pattern.findall(text)
if matches:
    text = pattern.sub("${REDACTED_TELEGRAM_TOKEN}", text)
    print(f"FIXED live token (occurrences: {len(matches)})")
else:
    print("no live token found")

if text != original:
    with open(BRIEF, "w", encoding="utf-8") as f:
        f.write(text)
    print("FILE WRITTEN")
else:
    print("NO CHANGE to file")
