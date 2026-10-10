#!/usr/bin/env bash
# t_76461419 — format guard for the gitleaks baseline (.gitleaksignore).
#
# The baseline may only suppress ONE finding at a time. Every line that is not
# blank and not a `#` comment must be a commit-scoped gitleaks fingerprint:
#
#     <40-hex commit>:<file>:<rule-id>:<line>
#
# Anything else is refused, in particular:
#   * a global fingerprint `<file>:<rule-id>:<line>` (no commit) — gitleaks
#     applies it to that file/line in EVERY commit, so a later real leak on the
#     same line number would be silently ignored;
#   * a bare path, rule id or pattern — would exclude a whole file or rule.
# The justification of every group lives in docs/security/gitleaks-baseline.md.
# The file must never contain a secret value: fingerprints only (a gitleaks JSON
# report used as `--baseline-path` would carry `Secret`/`Match` — not allowed).
#
# Usage: scripts/qa/check-gitleaksignore.sh [path]   (default: .gitleaksignore)
# Exit 0 = valid, 1 = invalid line(s) (reported by line number, content not echoed
# beyond the first 60 chars of the file/rule part), 2 = file missing.
set -euo pipefail

file="${1:-.gitleaksignore}"
if [[ ! -f "$file" ]]; then
  echo "check-gitleaksignore: $file not found" >&2
  exit 2
fi

re='^[0-9a-f]{40}:[^:[:space:]][^:]*:[a-z0-9][a-z0-9-]*:[1-9][0-9]*$'
bad=0
total=0
n=0
while IFS= read -r line || [[ -n "$line" ]]; do
  n=$((n + 1))
  [[ -z "${line//[[:space:]]/}" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  total=$((total + 1))
  if [[ ! "$line" =~ $re ]]; then
    bad=$((bad + 1))
    echo "check-gitleaksignore: $file:$n is not a commit-scoped fingerprint (commit:file:rule:line)" >&2
  fi
done < "$file"

dups=$(grep -vE '^[[:space:]]*(#|$)' "$file" | sort | uniq -d | wc -l)
if [[ "$dups" -gt 0 ]]; then
  echo "check-gitleaksignore: warning: $dups duplicated fingerprint(s) (harmless)" >&2
fi

if [[ "$bad" -gt 0 ]]; then
  echo "check-gitleaksignore: FAIL — $bad invalid line(s) out of $total entries" >&2
  exit 1
fi
echo "check-gitleaksignore: OK — $total commit-scoped fingerprints, no file/rule-wide exclusion"
