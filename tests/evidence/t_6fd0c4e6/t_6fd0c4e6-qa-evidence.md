# t_6fd0c4e6 — QA verdict evidence for t_325bea72 (root README assembly, PR #132 → d577aa4)

Author: qa profile. Date: 2026-10-10 (UTC). Verdict: **pass** (posted as a qa comment on t_325bea72).
Independent re-check: none of the results below are copied from the docs handoff or the architect review
(attachment 161 / comment #686). Each one was run again from this workspace.

## Sources under test

| Item | Value |
|---|---|
| Repo | zeldadil/password-manager, fresh `git fetch origin`; tip origin/master = a56dc76 |
| PR #132 squash | d577aa497657d9acaed9f343dcdee7d5cb67fef7, `git merge-base --is-ancestor d577aa4 origin/master` → true |
| README.md blob @ d577aa4 | 79c4d89a7f7838a895f420f12088885a3d6f7c47 (sha256 of bytes f63aec84225cb918e0110b5f37873b11061cbf4e4bb7890add9c8facbf2396cc) |
| README.md blob @ origin/master a56dc76 | e260d0c907655ffdd8def86481b945d10aa481de (sha256 fc22d8ec88f983be4a752abeece75823f66f2ffe53394bd9fce402c0a45f09b2). The later dd7ec14 (t_1708dc86, PR #133) changed Quick Start env text only. Both revisions were validated. |
| Push CI on d577aa4 | run 38063039148: event=push, headSha=d577aa4…, conclusion=success, 9/9 jobs success (secret-scan, install-lockfile, sast, unit, build, integration, dependency-audit, e2e, lint-typecheck), from `gh run view --json` |

## AC results

| AC | Result | How |
|---|---|---|
| AC1 README.md at repo root | PASS | `git ls-tree origin/master README.md` → blob at the root path |
| AC2 four sections, in order | PASS | `validate.py`: the first four H2 headings outside code fences are Project Overview (l.9), Architecture Diagram (l.63), Prerequisites (l.101), Quick Start (l.123). This holds at d577aa4 and at master. |
| AC3 mermaid renders on GitHub | PASS (see the limit below) | (a) GitHub's own GFM renderer (`gh api POST /markdown`, mode gfm, repo context) turns the block into a `section data-type="mermaid"` enrichment target served by viewscreen.githubusercontent.com. There is exactly 1 such section. (b) mermaid **11.17.2** `parse()`+`render()` in Chromium gives ok, 8 nodes, 2 clusters ("Client — browser trust boundary", "Server trust boundary — apps/services/api"), 8 edges, 0 error icons. These match the source: WEB, EXT, CKDF, API, CRYPTO, ORM, DB, PG. The mermaid body is byte-identical at d577aa4 and master. |
| AC4 Quick Start bash syntactically valid | PASS | `bash -n` on every bash fence inside Quick Start: d577aa4 has 2 blocks (l.129-146 with 16 lines, l.158-171 with 12 lines), rc 0. master has 3 blocks (+ l.201-206 from dd7ec14), rc 0. |

**Limit on AC3:** github.com HTML pages returned HTTP 503 ("Unicorn") to this host at 18:0x UTC, both by curl and in a
real browser. The GitHub API and githubstatus.com worked. So qa did **not** see the rendered iframe on github.com
itself. AC3 rests on GitHub's own renderer classifying the fence as mermaid, plus a successful render by the
current mermaid 11 release. The architect separately reports seeing the viewscreen render on github.com (comment #686).

**Non-vacuity controls:**
- `make_control.py` moves Prerequisites before Architecture Diagram and injects an unterminated quote into the first
  Quick Start block. `validate.py` then exits 1 with both an AC2 and an AC4 failure.
- The corrupted t_5b4429c9 attachment fed to the same mermaid 11.17.2 fails `parse()` with "Parse error on line 4 … got 'PS'".

**Other checks:**
- Relative links: 24 occurrences (14 unique), 0 missing in the d577aa4 tree or the master tree (`links.py`).
- Absolute URLs are only 127.0.0.1, localhost, the repo clone URL and learn.microsoft.com.
- Emails: `alice@example.test` (synthetic, reserved TLD).
- Secret-shaped strings: 0.
- Routes: `server.ts` @ d577aa4 registers health, openapi and auth at the root, and folders, resources and tags with `prefix: '/api/v1'`. This matches the curl commands (`/auth/register`, `/auth/unlock` without the prefix) and the diagram labels.

## Rulings on the two accepted deviations

1. **Diagram rewritten instead of taken from t_5b4429c9: ACCEPTED.** The source artifact
   (`/home/sap/.hermes/kanban/attachments/t_5b4429c9/mermaid-arch.md`, 1050 B, sha256
   aeef431c985dfbca63f243f1d69594bda38f58655bbbcb5dc318f5d6e59b24d0) cannot be used:
   - its fence is "````Itermail";
   - it contains a non-UTF-8 byte 0xa2, doubled quotes, `WER`/`WEB`, and `VAULTJ`;
   - mermaid rejects it;
   - it describes components that do not exist in this repo (Hermes Backend Services, LLM/Telegram).

   Embedding it would have failed AC3. The rewrite is consistent with the code (server.ts routes and prefixes,
   packages/crypto, Drizzle and SQLite). It also states the ADR-007 position honestly: server-side KDF today (solid
   edge, labelled "current"), client-side KDF planned (dashed).
2. **Security / ADR / License kept after the four sections: ACCEPTED.** All three sections were already on master
   before this card (559ccd3 has `## Security` l.147, `## ADRs (so far)` l.157, `## License` l.170, from PR #118).
   The formal Acceptance Criteria require "all four sections present, in order", and that is met: they are the first
   four H2 headings. "No extra sections" sits in the card's *Ensure* list, not in its ACs. Taken literally, it would
   remove the security notice and the disclosure pointer from a password-manager README, which would be a
   regression. Read as "nothing before or between the four", it holds.

## t_5b4429c9 a-posteriori finding

The qa PASS on t_5b4429c9 (comment 344, 2026-09-30) said the attachment "renders". The attachment's mtime is
2026-09-19, so it was already corrupted when that verdict was written, and it does not parse. That verdict was wrong.
Correction card: **t_1e217ae2** (triage, architect to route; the correction comment must be qa-authored). There is
no impact on shipped code, because PR #132 did not use the artifact.

## Not verified by qa

- The live github.com page render (503, see above).
- A live Quick Start run. For d577aa4, qa relied on the docs run at 559ccd3. Separately, qa ran the post-dd7ec14
  Quick Start in the t_1708dc86 review.
- The `corepack enable` path.

## Reproduce

```bash
git -C <clone> fetch origin
git -C <clone> show d577aa4:README.md > README.d577aa4.md
git -C <clone> show origin/master:README.md > README.master.md
SCRATCH=/tmp bash run.sh              # AC2/AC4 + negative control
python3 links.py <clone> d577aa4      # links / URLs / secrets
bash gfm.sh                           # GitHub GFM renderer classification (needs gh auth)
```

The mermaid render was done in Chromium with `import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'`,
then `mermaid.parse(src)` and `mermaid.render(id, src)`. The results are in `mermaid-render-transcript.json`.

## File digests (sha256)

```
f63aec84225cb918e0110b5f37873b11061cbf4e4bb7890add9c8facbf2396cc  README.d577aa4.md
fc22d8ec88f983be4a752abeece75823f66f2ffe53394bd9fce402c0a45f09b2  README.master.md
42d71ae15f6830abef904db38da89d1cdde6036fddffc59671b3c6d10e35901c  mermaid.d577aa4.mmd
3065236c238404be22ac986cb8948a1700ac2dc31fc14823126a2dfde6d13398  mermaid.t_5b4429c9-control.mmd
0d79c4e678934b3b9b4bb405cb616e3123e342f683554537367d3ee2e8411b53  validate.py
a58a100ff94de08f59966f568c6cbd61ed055fe96ad083cf72566cb8dff12c11  make_control.py
ff827a7deacd73368f981804e4582feb61c51bc68610432127aa94ae1c781ae6  run.sh
c94b3e7fb14caec3cfd00e02c329871ccf407cb37937ef36b28cc9e8811a6a0f  links.py
f1cab8373333a2bab06100f39187c7f6b4d88ec4c4817aa71977bb2f37301239  gfm.sh
88526fe2986f381670addd616db0cff946c91135df8af17e85cbd562de24d4fa  validation-transcript.txt
229b95bdfd8f142bb0266f58f5e912c01aa3216eeba7dfe4548b8e4b153c3ee5  links-d577aa4.txt
9c0aca23d90c1e4902e8aa6a84c9471a6a48dfa1298a3b4c17ac398fd15e5d28  links-master.txt
4a3aad96cef21a18a822e1981516ad7c913747ee752ad6cdfb9e30bc4b61c880  gfm-transcript.txt
0a128ad153075bbb946dc1ad4da6612534dd818b06ea70f23d93dc11c87acd81  mermaid-render-transcript.json
```

---

# Appendix: transcripts (verbatim)

## validation-transcript.txt

```
== d577aa4 (PR #132 squash) ==
H2 headings (outside fences):
  l.9: Project Overview
  l.63: Architecture Diagram
  l.101: Prerequisites
  l.123: Quick Start
  l.220: Security
  l.233: Architecture Decision Records
  l.248: License
AC2 PASS: four required sections are the first four H2, in order
  sections after the four required: ['Security', 'Architecture Decision Records', 'License']
mermaid blocks: [(71, 99)]
  mermaid header: flowchart LR; 27 lines
Quick Start fenced blocks: [('bash', 129, 146), ('bash', 158, 171)]
  bash -n block l.129-146 (16 lines): ok rc=0 
  bash -n block l.158-171 (12 lines): ok rc=0 

RESULT: PASS
exit=0

== origin/master a56dc76 (after dd7ec14) ==
H2 headings (outside fences):
  l.9: Project Overview
  l.63: Architecture Diagram
  l.101: Prerequisites
  l.123: Quick Start
  l.234: Security
  l.247: Architecture Decision Records
  l.262: License
AC2 PASS: four required sections are the first four H2, in order
  sections after the four required: ['Security', 'Architecture Decision Records', 'License']
mermaid blocks: [(71, 99)]
  mermaid header: flowchart LR; 27 lines
Quick Start fenced blocks: [('bash', 129, 146), ('bash', 158, 171), ('bash', 201, 206)]
  bash -n block l.129-146 (16 lines): ok rc=0 
  bash -n block l.158-171 (12 lines): ok rc=0 
  bash -n block l.201-206 (4 lines): ok rc=0 

RESULT: PASS
exit=0

== negative control: Prerequisites moved before Architecture Diagram, unclosed quote in a Quick Start block ==
H2 headings (outside fences):
  l.9: Project Overview
  l.63: Prerequisites
  l.85: Architecture Diagram
  l.123: Quick Start
  l.221: Security
  l.234: Architecture Decision Records
  l.249: License
  sections after the four required: ['Security', 'Architecture Decision Records', 'License']
mermaid blocks: [(93, 121)]
  mermaid header: flowchart LR; 27 lines
Quick Start fenced blocks: [('bash', 129, 147), ('bash', 159, 172)]
  bash -n block l.129-147 (17 lines): FAIL rc=2 /home/sap/.hermes/profiles/qa/cache/scratch/tmp5c32rm8w.sh: line 1: unexpected EOF while looking for matching `"'
  bash -n block l.159-172 (12 lines): ok rc=0 

RESULT: FAIL
  - AC2: first four H2 are ['Project Overview', 'Prerequisites', 'Architecture Diagram', 'Quick Start'], expected ['Project Overview', 'Architecture Diagram', 'Prerequisites', 'Quick Start']
  - AC4: bash -n failed for block l.129-147
exit=1
```

## links-d577aa4.txt

```
  ok   PROJECT_BRIEF.md
  ok   architecture/adr/ADR-007-vault-key-client-availability.md
  ok   architecture/adr/ADR-002-overall-architecture.md
  ok   architecture/adr/ADR-005-extension-bridge-protocol.md
  ok   PROJECT_BRIEF.md
  ok   architecture/adr/ADR-001-functional-patterns-from-passbolt.md
  ok   architecture/adr/ADR-002-overall-architecture.md
  ok   architecture/adr/SEC-001-threat-model.md
  ok   architecture/adr/ADR-007-vault-key-client-availability.md
  ok   .nvmrc
  ok   .npmrc
  ok   .env.example
  ok   architecture/adr/SEC-001-threat-model.md
  ok   architecture/adr/ADR-007-vault-key-client-availability.md
  ok   SECURITY.md
  ok   architecture/adr/ADR-001-functional-patterns-from-passbolt.md
  ok   architecture/adr/ADR-002-overall-architecture.md
  ok   architecture/adr/ADR-003-data-model.md
  ok   architecture/adr/ADR-004-api-contract.yaml
  ok   architecture/adr/ADR-005-extension-bridge-protocol.md
  ok   architecture/adr/ADR-006-workspace-manifest-crypto-path.md
  ok   architecture/adr/ADR-007-vault-key-client-availability.md
  ok   architecture/adr/SEC-001-threat-model.md
  ok   architecture/kanban/backlog.md
relative links: 24, missing: 0
absolute URLs:
  http://127.0.0.1:3000
  http://127.0.0.1:3000/auth/register
  http://127.0.0.1:3000/auth/unlock
  http://127.0.0.1:3000/health
  http://127.0.0.1:3000/openapi.json
  http://localhost:5173
  https://github.com/zeldadil/password-manager.git
  https://learn.microsoft.com/en-us/windows/wsl/
emails: ['alice@example.test', 'pnpm@9.12.0']
secret-shaped strings: 0
exit=0
```

## links-master.txt

```
  ok   PROJECT_BRIEF.md
  ok   architecture/adr/ADR-007-vault-key-client-availability.md
  ok   architecture/adr/ADR-002-overall-architecture.md
  ok   architecture/adr/ADR-005-extension-bridge-protocol.md
  ok   PROJECT_BRIEF.md
  ok   architecture/adr/ADR-001-functional-patterns-from-passbolt.md
  ok   architecture/adr/ADR-002-overall-architecture.md
  ok   architecture/adr/SEC-001-threat-model.md
  ok   architecture/adr/ADR-007-vault-key-client-availability.md
  ok   .nvmrc
  ok   .npmrc
  ok   .env.example
  ok   docs/development/setup.md
  ok   architecture/adr/SEC-001-threat-model.md
  ok   architecture/adr/ADR-007-vault-key-client-availability.md
  ok   SECURITY.md
  ok   architecture/adr/ADR-001-functional-patterns-from-passbolt.md
  ok   architecture/adr/ADR-002-overall-architecture.md
  ok   architecture/adr/ADR-003-data-model.md
  ok   architecture/adr/ADR-004-api-contract.yaml
  ok   architecture/adr/ADR-005-extension-bridge-protocol.md
  ok   architecture/adr/ADR-006-workspace-manifest-crypto-path.md
  ok   architecture/adr/ADR-007-vault-key-client-availability.md
  ok   architecture/adr/SEC-001-threat-model.md
  ok   architecture/kanban/backlog.md
relative links: 25, missing: 0
absolute URLs:
  http://127.0.0.1:3000
  http://127.0.0.1:3000/auth/register
  http://127.0.0.1:3000/auth/unlock
  http://127.0.0.1:3000/health
  http://127.0.0.1:3000/openapi.json
  http://localhost:5173
  https://github.com/zeldadil/password-manager.git
  https://learn.microsoft.com/en-us/windows/wsl/
emails: ['alice@example.test', 'pnpm@9.12.0']
secret-shaped strings: 0
exit=0
```

## gfm-transcript.txt

```
gh api /markdown exit=0 bytes=25802
<section class="js-render-needs-enrichment render-needs-enrichment position-relative" data-identity="713ddd9f-6478-422e-9de1-f5d667f61854" data-host="https://viewscreen.githubusercontent.com" data-src="https://viewscreen.githubusercontent.com/markdown/mermaid?docs_host=https%3A%2F%2Fdocs.github.com" data-type="mermaid" aria-label="mermaid rendered output container">
1
Project Overview
Architecture Diagram
Prerequisites
Quick Start
Security
Architecture Decision Records
License
```

## mermaid-render-transcript.json

```
{
 "tool": "mermaid (jsdelivr npm mermaid@11, ESM) parse()+render() in Chromium",
 "mermaid_version": "11.17.2",
 "inputs": {
  "README_d577aa4": "mermaid.d577aa4.mmd",
  "t_5b4429c9_control": "mermaid.t_5b4429c9-control.mmd"
 },
 "results": {
  "README_d577aa4": {
   "ok": true,
   "svgLen": 25545,
   "nodes": 8,
   "clusters": 2,
   "edges": 8,
   "labels": [
    "Server trust boundary \u2014 apps/services/api",
    "Client \u2014 browser trust boundary"
   ],
   "errIcons": 0
  },
  "t_5b4429c9_control": {
   "ok": false,
   "err": "Parse error on line 4:\n...[(\ufffdrowser Extension (Content Script + Ba\n-----------------------^\nExpecting 'SQE', 'DOUBLECIRCLEEND', 'PE', '-)', 'STADIUMEND', 'SUBROUTINEEND', 'PIPE', 'CYLINDEREND', 'DIAMOND_STOP', 'TAGEND', 'TRAPEND', 'INVTRAPEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got 'PS'"
  }
 }
}```
