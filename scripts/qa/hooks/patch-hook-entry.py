#!/usr/bin/env python3
"""Idempotent, comment-preserving install of ONE `hooks.pre_tool_call` entry into a
Hermes profile config.yaml (SEC-GATE / t_30e17642, used by install-merge-guard.sh).

Unlike patch-config.py (which only knows the QA sign-off gate entry), this appends a
new list item to an existing `hooks:` → `pre_tool_call:` list, creating the keys
when they are absent, and keeps every other byte of the file. The result is proven
with a real YAML parse before it is written: the parsed config must equal the
original parse plus exactly the new entry.

Usage:
  patch-hook-entry.py CONFIG --command PATH --matcher REGEX --marker TEXT
                      [--timeout N] [--dry-run]

Exit codes: 0 = applied, or already present (marker found) · 2 = validation failed
(file untouched) · 3 = usage error.
"""
import argparse
import copy
import re
import shutil
import sys
import time
from pathlib import Path
from typing import NoReturn


def die(msg: str, code: int = 2) -> NoReturn:
    print(f"patch-hook-entry: {msg}", file=sys.stderr)
    sys.exit(code)


def yaml_quote(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("--command", required=True)
    ap.add_argument("--matcher", required=True)
    ap.add_argument("--marker", required=True)
    ap.add_argument("--timeout", type=int, default=15)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    try:
        import yaml  # type: ignore
    except Exception:
        die("python3 PyYAML is required to validate the patched config")

    cfg = Path(a.config)
    if not cfg.is_file():
        die(f"config not found: {cfg}")
    original = cfg.read_text(encoding="utf-8")
    try:
        before = yaml.safe_load(original) or {}
    except Exception as exc:
        die(f"existing config does not parse ({exc}) — left untouched")

    existing = ((before.get("hooks") or {}).get("pre_tool_call") or []) if isinstance(before, dict) else []
    if any(a.marker in str((e or {}).get("command", "")) for e in existing if isinstance(e, dict)):
        print(f"patch-hook-entry: {a.marker} already present in {cfg} (no change)")
        return 0

    lines = original.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"

    def entry(indent: str) -> list[str]:
        pad = indent + "  "
        return [
            f"{indent}- matcher: {yaml_quote(a.matcher)}\n",
            f"{pad}command: {yaml_quote(a.command)}\n",
            f"{pad}timeout: {a.timeout}\n",
            f"{pad}fail_closed: true\n",
        ]

    hooks_idx = next((i for i, l in enumerate(lines) if re.match(r"^hooks:[ \t]*(#.*)?$", l.rstrip("\n"))), None)
    if hooks_idx is None:
        if re.search(r"(?m)^hooks:", original):
            die("`hooks:` is present in a form this patcher does not edit (inline mapping) — patch by hand")
        lines += ["\n", "# SEC-GATE t_30e17642 merge-guard — see scripts/qa/hooks/install-merge-guard.sh\n", "hooks:\n", "  pre_tool_call:\n"] + entry("    ")
    else:
        # end of the hooks: block = first later non-blank, non-comment line at column 0
        end = len(lines)
        for i in range(hooks_idx + 1, len(lines)):
            s = lines[i]
            if s.strip() and not s.startswith((" ", "\t", "#")):
                end = i
                break
        ptc_idx = next((i for i in range(hooks_idx + 1, end) if re.match(r"^\s+pre_tool_call:[ \t]*(#.*)?$", lines[i].rstrip("\n"))), None)
        if ptc_idx is None:
            child_indent = next((re.match(r"^(\s+)", lines[i]).group(1) for i in range(hooks_idx + 1, end) if lines[i].strip() and not lines[i].lstrip().startswith("#")), "  ")
            insert = [f"{child_indent}pre_tool_call:\n"] + entry(child_indent + "  ")
            lines[hooks_idx + 1:hooks_idx + 1] = insert
        else:
            ptc_indent = len(lines[ptc_idx]) - len(lines[ptc_idx].lstrip())
            item_indent = None
            last = ptc_idx
            for i in range(ptc_idx + 1, end):
                s = lines[i]
                if not s.strip() or s.lstrip().startswith("#"):
                    continue
                ind = len(s) - len(s.lstrip())
                if ind <= ptc_indent and not (ind == ptc_indent and s.lstrip().startswith("- ")):
                    break
                if item_indent is None and s.lstrip().startswith("- "):
                    item_indent = s[:ind]
                last = i
            if item_indent is None:
                item_indent = " " * (ptc_indent + 2)
            lines[last + 1:last + 1] = entry(item_indent)

    text = "".join(lines)
    try:
        after = yaml.safe_load(text)
    except Exception as exc:
        die(f"patched YAML does not parse ({exc}) — {cfg} left untouched")

    expected = copy.deepcopy(before) if isinstance(before, dict) else {}
    expected.setdefault("hooks", {})
    if expected["hooks"] is None:
        expected["hooks"] = {}
    expected["hooks"].setdefault("pre_tool_call", [])
    if expected["hooks"]["pre_tool_call"] is None:
        expected["hooks"]["pre_tool_call"] = []
    expected["hooks"]["pre_tool_call"].append({"matcher": a.matcher, "command": a.command, "timeout": a.timeout, "fail_closed": True})
    if after != expected:
        die(f"patched config is not exactly the original plus the new entry — {cfg} left untouched")

    if a.dry_run:
        print(f"patch-hook-entry: DRY RUN — {cfg} would gain pre_tool_call entry {a.matcher} → {a.command}")
        return 0

    backup = cfg.with_name(cfg.name + f".bak.{time.strftime('%Y%m%d%H%M%S')}")
    shutil.copy2(cfg, backup)
    cfg.write_text(text, encoding="utf-8")
    if yaml.safe_load(cfg.read_text(encoding="utf-8")) != expected:
        shutil.copy2(backup, cfg)
        die(f"post-write verification failed — restored {backup}")
    print(f"patch-hook-entry: patched {cfg} (backup: {backup})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
