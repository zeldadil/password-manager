#!/bin/bash
# fix-filter.sh — corrects the corrupted placeholder from the botched first filter-branch run
if [ -f PROJECT_BRIEF.md ]; then
  sed -i 's/\${}\TELEGRAM_BOT_TOKEN\${{}}/\${REDACTED_TELEGRAM_TOKEN}/g' PROJECT_BRIEF.md
  sed -i 's/8615677595:[A-Za-z0-9_]\{1,\}/\${REDACTED_TELEGRAM_TOKEN}/g' PROJECT_BRIEF.md
fi
