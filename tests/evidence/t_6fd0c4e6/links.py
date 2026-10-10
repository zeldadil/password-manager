#!/usr/bin/env python3
"""t_6fd0c4e6: relative-link + URL/secret hygiene check of README at a git rev. usage: links.py <repo> <rev>"""
import re, subprocess, sys
repo, rev = sys.argv[1], sys.argv[2]
text = subprocess.run(["git", "-C", repo, "show", f"{rev}:README.md"], capture_output=True, text=True, check=True).stdout
tree = set(subprocess.run(["git", "-C", repo, "ls-tree", "-r", "--name-only", rev], capture_output=True, text=True, check=True).stdout.split())
dirs = {"/".join(p.split("/")[:i]) for p in tree for i in range(1, p.count("/") + 1)}
bad = 0
links = re.findall(r"\]\(([^)\s]+)\)", text)
rel = [l for l in links if not re.match(r"^(https?:|mailto:|#)", l)]
for l in rel:
    p = l.split("#")[0].rstrip("/")
    ok = p in tree or p in dirs
    bad += not ok
    print(f"  {'ok  ' if ok else 'MISS'} {l}")
print(f"relative links: {len(rel)}, missing: {bad}")
urls = sorted(set(re.findall(r"https?://[^\s)`'\"<>]+", text)))
print("absolute URLs:")
for u in urls:
    print("  " + u)
emails = sorted(set(re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", text)))
print(f"emails: {emails}")
sec = re.findall(r"(?i)(ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|\d{8,10}:[A-Za-z0-9_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY)", text)
print(f"secret-shaped strings: {len(sec)}")
sys.exit(1 if bad or sec else 0)
