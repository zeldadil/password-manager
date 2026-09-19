#!/usr/bin/env python3
"""Idempotent, comment-preserving editor for a Hermes profile config.yaml.

Adds the QA sign-off gate `pre_tool_call` hook (QA-001h) to a profile config
without reformatting the file: the `hooks:` mapping is inserted textually and
the result is validated with a real YAML parse before it is written.

Usage:
  patch-config.py <config.yaml> <hook-command-path> [--auto-accept] [--dry-run]

Exit codes: 0 = applied (or already present) · 2 = validation failed (file untouched)

Only ever touches a `hooks.pre_tool_call` list entry whose command contains
`qa-signoff-gate.sh`, plus the single top-level `hooks_auto_accept` key.
"""
import re
import shutil
import sys
import time
from pathlib import Path


def die(msg: str, code: int = 2):
    print(f"patch-config: {msg}", file=sys.stderr)
    sys.exit(code)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if len(args) < 2:
        die("usage: patch-config.py <config.yaml> <hook-command-path> [--auto-accept] [--dry-run]")
    cfg_path = Path(args[0])
    hook_cmd = args[1]
    auto_accept = "--auto-accept" in flags
    dry_run = "--dry-run" in flags

    try:
        import yaml  # type: ignore
    except Exception:
        die("python3 PyYAML is required to validate the patched config")

    if not cfg_path.is_file():
        die(f"config not found: {cfg_path}")

    original = cfg_path.read_text(encoding="utf-8")
    text = original

    marker = "qa-signoff-gate.sh"
    if marker in text:
        print(f"patch-config: hook already present in {cfg_path} (no change)")
        return 0

    block = (
        "hooks:\n"
        "  pre_tool_call:\n"
        '    - matcher: "^kanban_complete$"\n'
        f'      command: "{hook_cmd}"\n'
        "      timeout: 30\n"
        "      fail_closed: true\n"
    )

    if re.search(r"(?m)^hooks:[ \t]*$", text):
        # Insert the pre_tool_call entry directly under the existing hooks: key
        # (lambda replacement: never let re.sub interpret escapes in the path).
        sub = "\n".join("  " + line for line in block.splitlines()[1:])
        text = re.sub(r"(?m)^hooks:[ \t]*$", lambda _m: "hooks:\n" + sub, text, count=1)
        # Also handle the (unlikely) inline `hooks: {}` form.
        text = text.replace("hooks: {}\n", block)
    else:
        if not text.endswith("\n"):
            text += "\n"
        text += "\n# QA-001h QA sign-off gate — see QA_SIGN_OFF_GATE.md\n" + block

    if auto_accept:
        if re.search(r"(?m)^hooks_auto_accept:", text):
            text = re.sub(r"(?m)^hooks_auto_accept:.*$", "hooks_auto_accept: true", text, count=1)
        else:
            text += "hooks_auto_accept: true\n"

    # Validate before writing: the file must parse and carry the expected keys.
    try:
        parsed = yaml.safe_load(text)
    except Exception as exc:
        die(f"patched YAML does not parse ({exc}) — {cfg_path} left untouched")
    try:
        entry = parsed["hooks"]["pre_tool_call"][0]
    except Exception:
        die(f"patched YAML has no hooks.pre_tool_call[0] — {cfg_path} left untouched")
    if hook_cmd not in str(entry.get("command", "")):
        die(f"patched hooks.pre_tool_call[0].command does not reference the hook — {cfg_path} left untouched")
    if entry.get("fail_closed") is not True:
        die(f"hooks.pre_tool_call[0].fail_closed must be true — {cfg_path} left untouched")
    if auto_accept and parsed.get("hooks_auto_accept") is not True:
        die(f"hooks_auto_accept was not set to true — {cfg_path} left untouched")

    if dry_run:
        print(f"patch-config: DRY RUN — would patch {cfg_path} with:\n{block}")
        return 0

    backup = cfg_path.with_suffix(cfg_path.suffix + f".bak.{time.strftime('%Y%m%d%H%M%S')}")
    shutil.copy2(cfg_path, backup)
    cfg_path.write_text(text, encoding="utf-8")
    # Re-parse from disk to prove what landed.
    reparsed = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    if hook_cmd not in str(reparsed["hooks"]["pre_tool_call"][0].get("command", "")):
        die(f"post-write verification failed — restore {backup}", code=2)
    print(f"patch-config: patched {cfg_path} (backup: {backup})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
