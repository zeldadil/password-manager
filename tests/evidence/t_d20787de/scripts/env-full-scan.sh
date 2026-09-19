#!/bin/bash
# t_d20787de — finish the measurements: (a) every token-shaped string in every profile .env / config.yaml,
# (b) trufflehog filesystem on the t_28951254 evidence dir, (c) the branch tip tree scan.
set -u
SCR=/home/sap/.hermes/kanban/workspaces/t_d20787de/scratch
WT="$SCR/wt-t28951254"
RED='s/[0-9]{8,12}:[A-Za-z0-9_-]{35}/<TOKEN-REDACTED>/g'
OUT="$SCR/env-full-scan.txt"

{
echo "=== (a) full token-shaped scan of every profile .env + config.yaml + ~/.hermes/.env ==="
python3 - <<'PY'
import hashlib, re
from pathlib import Path
pat = re.compile(r"[0-9]{8,12}:[A-Za-z0-9_-]{35}")
ROT = "df5ccd96d61f23a350efd8b3cb1e84b33ee552660446b167e07085e7baacadd2"
DEAD = "62fe6fe5053a50ec0570f5845ccd0ad39ea048c24239ae677c8eaa9a082e4aff"
def label(v):
    d = hashlib.sha256(v.encode()).hexdigest()
    if d == ROT: return "ROTATED-superseded(df5ccd96)"
    if d == DEAD: return "DEAD(62fe6fe5)"
    return "OTHER(" + d[:8] + ")"
files = []
for p in ["architect", "backend", "browser", "docs", "frontend", "product", "qa"]:
    files.append(Path.home() / ".hermes" / "profiles" / p / ".env")
    files.append(Path.home() / ".hermes" / "profiles" / p / "config.yaml")
files.append(Path.home() / ".hermes" / ".env")
files.append(Path.home() / ".hermes" / "config.yaml")
for f in files:
    if not f.exists():
        print(f"  {str(f):<52} ABSENT"); continue
    hits = pat.findall(f.read_text(errors="replace"))
    print(f"  {str(f):<52} token_shaped={len(hits)} {[label(h) for h in hits]}")
PY
echo
echo "=== (b) trufflehog filesystem on the t_28951254 evidence directory (branch tip) ==="
if [ -d "$WT/tests/evidence/t_28951254" ]; then
  set +e
  trufflehog filesystem "$WT/tests/evidence/t_28951254" --no-update --results=verified,unknown --fail > "$SCR/.th-ev.json" 2>"$SCR/.th-ev.err"
  RC=$?
  set -e
  echo "  exit code: $RC (183 = findings)"
  grep -o '"verified_secrets":[0-9]*' "$SCR/.th-ev.err" | tail -1
  echo "  findings: $(grep -c '"DetectorName"' "$SCR/.th-ev.json" 2>/dev/null || echo 0)"
  echo "  --- gitleaks dir-mode scan of the same dir ---"
  set +e
  gitleaks dir "$WT/tests/evidence/t_28951254" --no-banner --redact --report-format json --report-path "$SCR/.gl-ev.json" > "$SCR/.gl-ev.log" 2>&1
  GRC=$?
  set -e
  echo "  gitleaks exit: $GRC  findings: $(grep -c 'RuleID' "$SCR/.gl-ev.json" 2>/dev/null || echo 0)"
  sed -E "$RED" "$SCR/.gl-ev.log" | tail -3
  echo "  --- token-shaped regex over the dir tip tree ---"
  grep -r -c -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$WT/tests/evidence/t_28951254" 2>/dev/null | wc -l
else
  echo "  (worktree missing: $WT)"
fi
echo
echo "=== (c) does the branch's stale .gitleaksignore still match its (rewritten) history? ==="
cd "$WT" || exit 1
echo "  branch head: $(git rev-parse HEAD)"
echo "  suppressions listed in .gitleaksignore:"
sed -n 's/^\([0-9a-f]\{7,\}:.*\)$/    \1/p' .gitleaksignore
echo "  do those commits exist in the branch history?"
for c in $(sed -n 's/^\([0-9a-f]\{7,\}\):.*$/\1/p' .gitleaksignore); do
  if git cat-file -e "$c^{commit}" 2>/dev/null; then echo "    $c present"; else echo "    $c ABSENT (rewritten away)"; fi
done
} 2>&1 | tee "$OUT"
echo "--- leak self-check on transcript: $(grep -c -E '[0-9]{8,12}:[A-Za-z0-9_-]{35}' "$OUT") hit(s) ---"
