#!/usr/bin/env python3
"""Record the first-use consent for one shell hook in a profile's allowlist
(SEC-GATE / t_30e17642, used by install-merge-guard.sh).

Same record and same locking as Hermes itself (agent/shell_hooks.py
_record_approval: {event, command, approved_at, script_mtime_at_approval}, an
exclusive flock on `<allowlist>.lock`, atomic replace), so `hermes hooks list`
shows the hook as "✓ allowed" and `hermes hooks doctor` sees no mtime drift.
Profiles with `hooks_auto_accept: true` would record exactly this on their next
start; recording it at install time makes the consent visible and auditable now,
and covers a profile without auto-accept.

Usage: approve-hook.py <profile-dir> <hook-command-path> [--event pre_tool_call]
"""
import fcntl
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    event = "pre_tool_call"
    if "--event" in sys.argv:
        event = sys.argv[sys.argv.index("--event") + 1]
        args = [a for a in args if a != event]
    if len(args) != 2:
        print("usage: approve-hook.py <profile-dir> <hook-command-path> [--event EVENT]", file=sys.stderr)
        return 3
    profile_dir, command = Path(args[0]), args[1]
    if not Path(command).is_file():
        print(f"approve-hook: hook script not found: {command}", file=sys.stderr)
        return 2
    allowlist = profile_dir / "shell-hooks-allowlist.json"
    lock = allowlist.with_suffix(allowlist.suffix + ".lock")
    with open(lock, "a+", encoding="utf-8") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            try:
                data = json.loads(allowlist.read_text(encoding="utf-8-sig"))
            except (OSError, json.JSONDecodeError):
                data = {}
            if not isinstance(data, dict):
                data = {}
            raw = data.get("approvals")
            approvals = [e for e in (raw if isinstance(raw, list) else []) if not (isinstance(e, dict) and e.get("event") == event and e.get("command") == command)]
            approvals.append({
                "event": event,
                "command": command,
                "approved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "script_mtime_at_approval": iso(os.path.getmtime(command)),
            })
            data["approvals"] = approvals
            fd, tmp = tempfile.mkstemp(dir=str(profile_dir), prefix=".shell-hooks-allowlist.", suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                json.dump(data, out, indent=2, sort_keys=True)
                out.write("\n")
            os.chmod(tmp, 0o600)
            os.replace(tmp, allowlist)
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    print(f"approve-hook: recorded {event} consent for {command} in {allowlist}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
