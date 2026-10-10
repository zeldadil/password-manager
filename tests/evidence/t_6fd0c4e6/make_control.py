#!/usr/bin/env python3
"""Build a deliberately non-compliant README from a compliant one (negative control)."""
import sys
src, dst = sys.argv[1], sys.argv[2]
t = open(src, encoding="utf-8").read()
a = t.index("## Architecture Diagram")
p = t.index("## Prerequisites")
q = t.index("## Quick Start")
t = t[:a] + t[p:q] + t[a:p] + t[q:]           # reorder: Prerequisites before Architecture Diagram
q = t.index("## Quick Start")
b = t.index("```bash", q)
t = t[:b] + "```bash\necho \"unterminated\n" + t[b + len("```bash\n"):]  # syntax error
open(dst, "w", encoding="utf-8").write(t)
