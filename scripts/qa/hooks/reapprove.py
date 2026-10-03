#!/usr/bin/env python3
"""Re-approve both hooks for architect profile with ISO-8601 mtimes matching
the format hermes hooks doctor stores/readss (script_mtime_iso format)."""
import json, sys
from datetime import datetime, timezone
from pathlib import Path

PROFILE = Path("/home/sap/.hermes/profiles/architect")
ALLOWLIST = PROFILE / "shell-hooks-allowlist.json"

data = {}
if ALLOWLIST.exists():
    data = json.loads(ALLOWLIST.read_text())

approvals = data.get("approvals", [])

for cmd_name in ["secret-guard.sh", "qa-signoff-gate.sh"]:
    command = str(PROFILE / "agent-hooks" / cmd_name)
    path = Path(command)
    if not path.exists():
        print(f"SKIP: {command} not found", file=sys.stderr)
        continue
    # Use the SAME format as script_mtime_iso() — ISO-8601 with Z suffix
    mtime = path.stat().st_mtime
    mtime_iso = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    # Remove any stale entry for this command
    approvals = [e for e in approvals if e.get("command") != command]
    approvals.append({
        "event": "pre_tool_call",
        "command": command,
        "approved_at": now,
        "script_mtime_at_approval": mtime_iso,  # ISO format, same as script_mtime_iso()
    })
    print(f"Re-approved {cmd_name}: {mtime_iso}")

data["approvals"] = approvals
ALLOWLIST.write_text(json.dumps(data, indent=2) + "\n")
print(f"Total approvals: {len(approvals)}")
