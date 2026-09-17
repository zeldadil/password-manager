#!/usr/bin/env python3
"""
Idempotent, comment-preserving editor for a Hermes profile config.yaml.

Adds a `pre_tool_call` hook entry to a profile config without reformatting the
file: the entry is inserted textually and the result is validated with a real
YAML parse before it is written.

Usage:
  patch-config.py <config.yaml> <hook-command-path> \
      [--hook-marker MARKER] [--matcher REGEX] [--auto-accept] [--dry-run]

Exit codes: 0 = applied (or already present) · 2 = validation failed (file untouched)

--hook-marker (default: the hook command path basename): the substring that
  identifies whether the hook is already present in the config.
--matcher (default: ^kanban_complete$): the matcher regex the entry should carry.
"""

import re
import shutil
import sys
import time
from pathlib import Path


def die(msg: str, code: int = 2):
    print(f"patch-config: {msg}", file=sys.stderr)
    sys.exit(code)


def find_pre_tool_call_block(text):
    """
    Find the hooks.pre_tool_call block in config text.
    Returns (block_start, insert_at, indent) or None.
    block_start = position of the `pre_tool_call:` line
    insert_at = position where a new list entry should be inserted (after existing entries)
    indent = the indentation of the pre_tool_call key
    """
    m = re.search(r"(?m)^(\s*)pre_tool_call:\s*$", text)
    if not m:
        return None
    block_start = m.start()
    indent = m.group(1)
    # Find where the list entries end and the next top-level line begins
    pos = m.end()
    while pos < len(text):
        next_nl = text.find("\n", pos)
        if next_nl == -1:
            return (block_start, len(text), indent)
        line_text = text[pos:next_nl]
        line_start = pos
        line_indent = len(line_text) - len(line_text.lstrip())

        if line_text.strip() == "":
            # Empty line — check if next non-empty line is top-level
            scan = next_nl + 1
            while scan < len(text):
                nn = text.find("\n", scan)
                if nn == -1:
                    next_line = text[scan:]
                    scan = len(text)
                else:
                    next_line = text[scan:nn]
                    scan = nn + 1
                if next_line.strip() == "":
                    continue
                if len(next_line) - len(next_line.lstrip()) == 0:
                    return (block_start, line_start, indent)
                break
            pos = next_nl + 1
            continue

        if line_indent == 0:
            return (block_start, line_start, indent)

        if line_indent < len(indent) and line_text.strip():
            return (block_start, line_start, indent)

        pos = next_nl + 1

    return (block_start, len(text), indent)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if len(args) < 2:
        die("usage: patch-config.py <config.yaml> <hook-command-path> [--hook-marker MARKER] [--matcher REGEX] [--auto-accept] [--dry-run]")
    cfg_path = Path(args[0])
    hook_cmd = args[1]
    hook_marker = "--hook-marker" in flags
    hook_marker_val = None
    matcher = "^kanban_complete$"
    if "--matcher" in flags:
        idx = list(sys.argv[1:]).index("--matcher")
        matcher = sys.argv[2 + idx] if 2 + idx < len(sys.argv) else "^kanban_complete$"
    auto_accept = "--auto-accept" in flags
    dry_run = "--dry-run" in flags

    if hook_marker:
        idx = list(sys.argv[1:]).index("--hook-marker")
        hook_marker_val = sys.argv[2 + idx] if 2 + idx < len(sys.argv) else hook_cmd
    else:
        hook_marker_val = hook_cmd

    try:
        import yaml  # type: ignore
    except Exception:
        die("python3 PyYAML is required to validate the patched config")

    if not cfg_path.is_file():
        die(f"config not found: {cfg_path}")

    original = cfg_path.read_text(encoding="utf-8")
    text = original

    if hook_marker_val in text:
        print(f"patch-config: hook (marker={hook_marker_val!r}) already present in {cfg_path} (no change)")
        return 0

    block_info = find_pre_tool_call_block(text)
    if block_info:
        block_start, insert_at, indent = block_info
        new_entry = (
            f"{indent}  - matcher: \"{matcher}\"\n"
            f"{indent}    command: \"{hook_cmd}\"\n"
            f"{indent}    timeout: 30\n"
            f"{indent}    fail_closed: true\n"
        )
        existing_block = text[block_start:insert_at]
        if f'command: "{hook_cmd}"' in existing_block:
            print(f"patch-config: hook command already in pre_tool_call list (no change)")
            return 0
        text = text[:insert_at] + new_entry + text[insert_at:]
        if auto_accept and not re.search(r"(?m)^hooks_auto_accept:", text):
            text += "hooks_auto_accept: true\n"
    else:
        # No pre_tool_call yet
        hooks_key = re.search(r"(?m)^hooks:\s*$", text)
        if hooks_key:
            insert_at = hooks_key.end()
            pos = insert_at
            while pos < len(text):
                next_nl = text.find("\n", pos)
                if next_nl == -1:
                    line_text = text[pos:]
                    pos = len(text)
                else:
                    line_text = text[pos:next_nl]
                    pos = next_nl + 1
                if line_text.strip() == "":
                    continue
                if len(line_text) - len(line_text.lstrip()) == 0:
                    if re.match(r"\w+:", line_text.strip()) or line_text.strip().startswith("#"):
                        insert_at = pos - len(line_text) - 1 if pos > insert_at else insert_at
                    break
            new_entry = (
                "  pre_tool_call:\n"
                f"    - matcher: \"{matcher}\"\n"
                f"      command: \"{hook_cmd}\"\n"
                "      timeout: 30\n"
                "      fail_closed: true\n"
            )
            text = text[:insert_at] + new_entry + text[insert_at:]
        else:
            if not text.endswith("\n"):
                text += "\n"
            text += "\n# SEC-001 / T_B51A1FF3 secret-guard hook — see SEC-001-threat-model.md\n"
            text += "hooks:\n"
            text += "  pre_tool_call:\n"
            text += f"    - matcher: \"{matcher}\"\n"
            text += f"      command: \"{hook_cmd}\"\n"
            text += "      timeout: 30\n"
            text += "      fail_closed: true\n"

        if auto_accept:
            if re.search(r"(?m)^hooks_auto_accept:", text):
                text = re.sub(r"(?m)^hooks_auto_accept:.*$", "hooks_auto_accept: true", text, count=1)
            else:
                text += "hooks_auto_accept: true\n"

    # Validate
    try:
        parsed = yaml.safe_load(text)
    except Exception as exc:
        die(f"patched YAML does not parse ({exc}) — {cfg_path} left untouched")
    try:
        entries = parsed["hooks"]["pre_tool_call"]
        if not isinstance(entries, list) or len(entries) == 0:
            die(f"patched hooks.pre_tool_call must be a non-empty list — {cfg_path} left untouched")
    except Exception:
        die(f"patched YAML has no hooks.pre_tool_call list — {cfg_path} left untouched")
    found_our = False
    for e in entries:
        if hook_cmd in str(e.get("command", "")):
            found_our = True
            if e.get("fail_closed") is not True:
                die(f"hooks.pre_tool_call entry for {hook_cmd} must have fail_closed: true — {cfg_path} left untouched")
            break
    if not found_our:
        die(f"patched hooks.pre_tool_call has no entry referencing {hook_cmd} — {cfg_path} left untouched")
    if auto_accept and parsed.get("hooks_auto_accept") is not True:
        die(f"hooks_auto_accept was not set to true — {cfg_path} left untouched")

    if dry_run:
        print(f"patch-config: DRY RUN — would patch {cfg_path}")
        return 0

    backup = cfg_path.with_suffix(cfg_path.suffix + f".bak.{time.strftime('%Y%m%d%H%M%S')}")
    shutil.copy2(cfg_path, backup)
    cfg_path.write_text(text, encoding="utf-8")
    reparsed = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    found = False
    for e in (reparsed["hooks"]["pre_tool_call"] or []):
        if hook_cmd in str(e.get("command", "")):
            found = True
            if e.get("fail_closed") is not True:
                die(f"post-write verification failed — restore {backup}", code=2)
            break
    if not found:
        die(f"post-write verification failed — restore {backup}", code=2)
    print(f"patch-config: patched {cfg_path} (backup: {backup})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
