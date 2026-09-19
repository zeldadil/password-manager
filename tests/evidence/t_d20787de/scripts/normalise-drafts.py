#!/usr/bin/env python3
"""t_d20787de — normalise the drafts so no comment claims a path that does not exist yet.

The gate has no /m flag on its evidence-label regex, so a label at the start of a line is *not*
recognised as a label region: every path-shaped token outside a code span is a CLAIM. Drafts must
therefore only contain claimable paths that already exist on a ref (or in the worker's workspace).
"""
from pathlib import Path

D = Path("/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch/drafts")
for f in sorted(D.glob("*.md")):
    t = f.read_text()
    before = t
    # the t_d20787de bundle is produced *after* the comments are posted: name it without a trailing
    # slash so it is not read as a directory pointer/claim.
    t = t.replace("tests/evidence/t_d20787de/", "tests/evidence/t_d20787de")
    if t != before:
        f.write_text(t)
        print(f"patched {f.name}")
    else:
        print(f"unchanged {f.name}")
