#!/usr/bin/env bash
# bundle evidence README + transcripts into one attachable markdown file
set -eu
cd "$(dirname "$0")"
out=t_6fd0c4e6-qa-evidence.md
cp README.md "$out"
printf '\n---\n\n# Appendix: transcripts (verbatim)\n' >> "$out"
for f in validation-transcript.txt links-d577aa4.txt links-master.txt gfm-transcript.txt mermaid-render-transcript.json; do
  printf '\n## %s\n\n```\n' "$f" >> "$out"
  cat "$f" >> "$out"
  printf '```\n' >> "$out"
done
sha256sum "$out"
wc -c "$out"
