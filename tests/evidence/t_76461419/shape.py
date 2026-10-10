#!/usr/bin/env python3
"""Summarise gitleaks findings WITHOUT printing any secret value.

For every finding prints: rule, commit, file, line, the key name (text up to
the separator) and a masked shape of the value. The value itself is shown
only when it is unmistakably a code expression (dotted identifier path such
as `foo.bar.baz` or a call like `fn(`), never otherwise.
Usage: shape.py raw.json repo_dir
"""
import json, re, sys, subprocess

rep = json.load(open(sys.argv[1]))
repo = sys.argv[2]

def mask(v):
    return re.sub(r'[a-z]', 'a', re.sub(r'[A-Z]', 'A', re.sub(r'[0-9]', '9', v)))

CODE = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)+')

for f in rep:
    sec = f['Secret']
    rule = f['RuleID']
    if rule == 'generic-api-key':
        m = re.match(r'''(?i)(.*?(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret))(\s*[=:]\s*['"]?)(.*?)(['"]?)$''', sec)
        key, val = (m.group(1), m.group(3)) if m else ('?', sec)
    else:
        key, val = '', sec
    shown = val if (rule == 'generic-api-key' and CODE.fullmatch(val)) else '<' + mask(val) + '>'
    # line context with the secret masked
    try:
        blob = subprocess.run(['git', '-C', repo, 'show', f"{f['Commit']}:{f['File']}"], capture_output=True, text=True).stdout.splitlines()
        ctx = blob[f['StartLine'] - 1].replace(sec, '«MATCH»').strip()[:110]
        if val and val in ctx:
            ctx = ctx.replace(val, '«V»')
    except Exception as e:  # noqa
        ctx = f'<ctx err {e}>'
    print('\t'.join([rule, f['Commit'][:8], f['File'], str(f['StartLine']), key[-30:], shown, ctx]))
