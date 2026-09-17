#!/usr/bin/env python3
"""Fix the allowlist to use ISO-8601 mtime format (same as script_mtime_iso())."""
import json
from datetime import datetime, timezone
from pathlib import Path

PROFILE = Path("/home/sap/.hermes/profiles/architect")
ALLOWLIST = PROFILE / "shell-hooks-allowlist.json"

data = json.loads(ALLOWLIST.read_text())
approvals = data.get("approvals", [])

for entry in approvals:
    cmd = entry.get("command", "")
    # Get current mtime as ISO format matching script_mtime_iso()
    path = Path(cmd)
    if path.exists():
        mtime = path.stat().st_mtime
        entry["script_mtime_at_approval"] = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        print(f"Fixed {Path(cmd).name}: {entry['script_mtime_at_approval']}")
    else:
        print(f"MISSING: {cmd}")

ALLOWLIST.write_text(json.dumps(data, indent=2) + "\n")
print("Allowlist updated.")
