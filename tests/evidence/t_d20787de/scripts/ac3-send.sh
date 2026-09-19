#!/bin/bash
# t_d20787de — AC3 sensor for t_28951254: a real `hermes send` from two different profiles.
# Exit codes only; the message never contains a secret.
set -u
MSG='QA t_d20787de AC3 re-verification (t_28951254): Telegram channel live from the %s profile — exit 0. Retro-verification of the .env token propagation, 2026-09-19.'
run_one() {
  local prof="$1"
  printf '  profile %-10s ' "$prof"
  HERMES_HOME="/home/sap/.hermes/profiles/$prof" hermes send --to telegram:956145756 -q "$(printf "$MSG" "$prof")" >/dev/null 2>&1
  echo "exit=$?"
}
echo "=== hermes send exit codes (real sends to the human's chat) ==="
run_one qa
run_one backend
echo
echo "=== which credential source did hermes send use? (fingerprint only) ==="
python3 - <<'PY'
import hashlib, os, re
pat = re.compile(r"[0-9]{8,12}:[A-Za-z0-9_-]{35}")
for p in ["/home/sap/.hermes/.env", "/home/sap/.hermes/config.yaml"]:
    try:
        t = open(p, errors="replace").read()
    except FileNotFoundError:
        print(f"  {p}: absent"); continue
    hits = set(pat.findall(t))
    print(f"  {p}: token_shaped_values={len(hits)} fingerprints={[hashlib.sha256(h.encode()).hexdigest()[:8]+'…' for h in hits]}")
PY
