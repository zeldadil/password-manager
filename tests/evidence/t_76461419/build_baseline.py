#!/usr/bin/env python3
"""t_76461419 — build the gitleaks fingerprint baseline + justification doc.

Input : redacted gitleaks JSON of the findings NOT yet covered by .gitleaksignore
        (no secret value is read or written by this script), and the
        telegram revocation check output (fingerprint -> sha256 prefix, http).
Output: new-fingerprints.txt (one fingerprint per line, grouped, no comments)
        groups.md (markdown sections for docs/security/gitleaks-baseline.md)
"""
import json, re, sys, collections

findings = json.load(open(sys.argv[1]))
tg = {}
cur = None
for line in open(sys.argv[2]):
    m = re.match(r'sha256\[:16\]=(\w+)\s+http=(\S+)', line)
    if m:
        cur = (m.group(1), m.group(2))
    elif line.startswith('    ') and cur:
        tg[line.strip()] = cur

TG_KNOWN = {
    '62fe6fe5053a50ec': ('G6', 'original incident token (t_0af5aa3e / t_930fddbe / t_80fc0326); sha256 matches tests/evidence/t_e348e0b7/README.md'),
    'df5ccd96d61f23a3': ('G6', 'rotated value propagated by t_28951254 and later rotated again; sha256 matches tests/evidence/t_d20787de/scripts/*.py'),
}

def group(f):
    r, p = f['RuleID'], f['File']
    if r == 'telegram-token':
        return 'G6'
    if r == 'aws-access-key-id':
        return 'G5'
    if p.startswith('tests/evidence/'):
        return 'G4'
    if p.startswith(('architecture/', 'docs/')):
        return 'G3'
    if p.startswith(('apps/services/api/src/', 'apps/web/src/api/client.ts', 'apps/web/src/api/tokenStore.ts', 'scripts/qa/signoff-gate.mjs')):
        return 'G2'
    if re.search(r'(^|/)tests?/|\.test\.tsx?$', p):
        return 'G1'
    raise SystemExit(f'unclassified: {f["RuleID"]} {p}')

TITLES = {
    'G1': 'Test fixtures (synthetic credentials and token-generator calls in test code)',
    'G2': 'Source code expressions, no literal value (env lookups, property accesses, function calls)',
    'G3': 'Documentation placeholders',
    'G4': 'QA evidence files (snapshots of gate code, verdict-token inventories, probe tests)',
    'G5': 'Secret-guard test vectors (synthetic AWS access key id)',
    'G6': 'telegram-token detections — every distinct value checked revoked (getMe = 401)',
}

by = collections.defaultdict(list)
seen = set()
for f in findings:
    fp = f['Fingerprint']
    if fp in seen:
        continue
    seen.add(fp)
    by[group(f)].append(f)

order = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']
with open('new-fingerprints.txt', 'w') as out:
    for g in order:
        for f in sorted(by[g], key=lambda f: f['Fingerprint']):
            out.write(f['Fingerprint'] + '\n')

md = []
for g in order:
    fs = by[g]
    md.append(f'### {g} — {TITLES[g]} ({len(fs)} fingerprints)\n')
    files = collections.Counter((f['RuleID'], f['File']) for f in fs)
    md.append('| rule | file | fingerprints |\n|---|---|---|')
    for (r, p), n in sorted(files.items()):
        md.append(f'| `{r}` | `{p}` | {n} |')
    md.append('')
    if g == 'G6':
        md.append('| fingerprint | sha256(value)[:16] | getMe HTTP (2026-10-10) | identification |\n|---|---|---|---|')
        for f in sorted(fs, key=lambda f: f['Fingerprint']):
            h, code = tg[f['Fingerprint']]
            ident = TG_KNOWN.get(h, ('', 'not identified in board evidence; dead (401)'))[1]
            md.append(f'| `{f["Fingerprint"]}` | `{h}` | {code} | {ident} |')
        md.append('')
    md.append('<details><summary>fingerprints</summary>\n\n```')
    for f in sorted(fs, key=lambda f: f['Fingerprint']):
        md.append(f['Fingerprint'])
    md.append('```\n\n</details>\n')
open('groups.md', 'w').write('\n'.join(md))
print({g: len(by[g]) for g in order}, 'total', sum(len(v) for v in by.values()))
