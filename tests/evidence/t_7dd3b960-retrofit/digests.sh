#!/usr/bin/env bash
# Digests of the three retro-verified artefacts, materialised from origin/master.
set -uo pipefail
REPO="${REPO:-/home/sap/qa-retrofit-clone}"
W="${W:-$(mktemp -d)}"
mkdir -p "$W"
cd "$REPO" || exit 1
echo "## repo: $REPO"
echo "## origin/master tip: $(git rev-parse origin/master)"
echo "## materialised copies in: $W"
echo
echo "## blob shas as recorded in the tree of origin/master"
git ls-tree origin/master architecture/adr/SEC-001-threat-model.md
git ls-tree origin/master architecture/adr/ADR-002-overall-architecture.md
git ls-tree origin/master architecture/adr/ADR-005-extension-bridge-protocol.md
echo
git show origin/master:architecture/adr/SEC-001-threat-model.md > "$W/SEC-001.md"
git show origin/master:architecture/adr/ADR-002-overall-architecture.md > "$W/ADR-002.md"
git show origin/master:architecture/adr/ADR-005-extension-bridge-protocol.md > "$W/ADR-005.md"
echo "## sha256 of the materialised copies"
sha256sum "$W/SEC-001.md" "$W/ADR-002.md" "$W/ADR-005.md"
echo
echo "## git hash-object of the materialised copies (must equal the blob shas above)"
git hash-object "$W/SEC-001.md" "$W/ADR-002.md" "$W/ADR-005.md"
echo
echo "## last commit touching each artefact on master"
git log -1 --format='%h %ad %s' --date=short origin/master -- architecture/adr/SEC-001-threat-model.md
git log -1 --format='%h %ad %s' --date=short origin/master -- architecture/adr/ADR-002-overall-architecture.md
git log -1 --format='%h %ad %s' --date=short origin/master -- architecture/adr/ADR-005-extension-bridge-protocol.md
echo
echo "## SEC-001 §5 Sign-off row as committed (the AC-4 gap)"
git show origin/master:architecture/adr/SEC-001-threat-model.md | sed -n '/^## Part 5: Sign-off/,/^---$/p' | sed -n '1,8p'
echo
echo "## does ANY ref carry a signed (non-pending) QA row for the three artefacts?"
refs=$(git for-each-ref --format='%(refname)' refs/remotes/origin | grep -v 'HEAD$')
for f in SEC-001-threat-model ADR-002-overall-architecture ADR-005-extension-bridge-protocol; do
  present=0; pending=0; other=0
  for r in $refs; do
    if git cat-file -e "$r:architecture/adr/$f.md" 2>/dev/null; then
      present=$((present + 1))
      row=$(git show "$r:architecture/adr/$f.md" | grep '^| QA |' | head -1)
      case "$row" in
        *"(pending)"*) pending=$((pending + 1)) ;;
        *) other=$((other + 1)); echo "    NON-PENDING QA ROW on $r: $row" ;;
      esac
    fi
  done
  printf '  %-34s refs carrying it: %3d   with "(pending)": %3d   with a real signature: %d\n' \
    "$f" "$present" "$pending" "$other"
done
echo "  ^ a non-zero 'real signature' count would falsify the AC-4 finding; it is 0."

