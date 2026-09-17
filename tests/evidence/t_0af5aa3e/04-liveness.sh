#!/usr/bin/env bash
# Liveness check of the leaked Telegram bot token WITHOUT printing the value.
# Extracts the token from the public mirror's history in-memory and calls the
# Telegram getMe endpoint. Prints only HTTP status + (on 200) the bot username.
set -u
WS=/home/sap/.hermes/kanban/workspaces/t_0af5aa3e/verify
RAW="$WS/raw"
mkdir -p "$RAW"
cd "$WS/repo.git" || exit 1

TOKEN=$(git show a503e4d3601762619fa751138a4b360ea65621f6:PROJECT_BRIEF.md \
        | grep -oE '[0-9]{8,12}:[A-Za-z0-9_-]{35}' | head -1)

if [ -z "${TOKEN:-}" ]; then
  echo "RESULT: could not extract token from the public commit — nothing to check"
  exit 0
fi
echo "extracted token: ${#TOKEN} chars, prefix $(echo "$TOKEN" | cut -d: -f1 | cut -c1-4)****  (value withheld)"

CODE=$(curl -sS -o "$RAW/getme.json" -w '%{http_code}' --max-time 20 \
        "https://api.telegram.org/bot${TOKEN}/getMe" 2>"$RAW/getme.err")
echo "Telegram getMe HTTP status: $CODE"
if [ "$CODE" = "200" ]; then
  echo "RESULT: TOKEN IS LIVE (still accepted by Telegram)"
  echo "bot username reported by Telegram:"
  jq -r '.result.username // "(none)"' "$RAW/getme.json"
  jq -r '.result.first_name // ""' "$RAW/getme.json"
elif [ "$CODE" = "401" ]; then
  echo "RESULT: token REVOKED/DEAD (401 Unauthorized) — rotation has happened"
else
  echo "RESULT: inconclusive (HTTP $CODE)"
  head -c 300 "$RAW/getme.err" 2>/dev/null
fi
