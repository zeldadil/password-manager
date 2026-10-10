#!/usr/bin/env bash
# t_6fd0c4e6: ask GitHub's own GFM renderer (REST /markdown, repo context) how it treats the README mermaid fence
set -u
cd "$(dirname "$0")"
python3 - <<'EOF' > gfm-request.json
import json
print(json.dumps({"text": open("README.d577aa4.md", encoding="utf-8").read(), "mode": "gfm", "context": "zeldadil/password-manager"}))
EOF
gh api -X POST /markdown --input gfm-request.json > gfm-render.d577aa4.html
echo "gh api /markdown exit=$? bytes=$(wc -c < gfm-render.d577aa4.html)"
grep -o '<section[^>]*data-type="mermaid"[^>]*>' gfm-render.d577aa4.html | head -3
grep -c 'data-type="mermaid"' gfm-render.d577aa4.html
grep -o '<h2[^>]*>.*</h2>' gfm-render.d577aa4.html | sed 's/<[^>]*>//g'
