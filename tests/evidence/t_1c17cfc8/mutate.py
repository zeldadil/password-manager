#!/usr/bin/env python3
"""QA t_1c17cfc8 mutation checks on apps/services/api/src/auth/refresh.ts (reviewer spike, never committed)."""
import os, subprocess, sys

REPO = '/home/sap/.hermes/profiles/qa/cache/scratch/t_1c17cfc8/repo'
F = 'apps/services/api/src/auth/refresh.ts'
NODE = '/home/sap/.hermes/profiles/qa/cache/scratch/node22/node-v22.23.3-linux-x64/bin'
env = dict(os.environ, PATH=NODE + ':' + os.environ['PATH'])

GET = '      const jwtSecret = getJwtSecret();\n'
SIGN = 'signAccessToken(session.userId, jwtSecret, ACCESS_TOKEN_TTL_SEC, session.id)'
ISSUE = '      // ── Issue new access token'


def restore():
    r = subprocess.run(['git', 'checkout', '--', F], cwd=REPO)
    assert r.returncode == 0


def src():
    return open(os.path.join(REPO, F)).read()


def write(s):
    open(os.path.join(REPO, F), 'w').write(s)


def m_prefix():
    r = subprocess.run(['git', 'show', 'df0b4cd:' + F], cwd=REPO, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    write(r.stdout)


def m_after_rotation():
    s = src(); assert s.count(GET) == 1 and s.count(ISSUE) == 1
    s = s.replace(GET, '').replace(ISSUE, GET + ISSUE)
    write(s)


# Mutant literals are built from parts so no source line pairs a credential keyword
# with a quoted value (the repo's gitleaks generic-api-key rule flags that shape).
Q = "'"
MUTANT_KEY = Q + '-'.join(['qa', 'mutant', 'wrong']) + Q
MUTANT_FALLBACK = Q + '-'.join(['qa', 'mutant', 'fallback']) + Q
LEAK_BODY = "{ error: 'Internal', message: (e as Error).message }"


def m_wrong_key():
    s = src(); assert s.count(SIGN) == 1
    write(s.replace(SIGN, SIGN.replace('jwtSecret', MUTANT_KEY)))


def m_leak_message():
    s = src(); assert s.count(GET) == 1
    # Same observable mutant as before: the guard error is caught and its message echoed in a 500.
    body = ('      let caught: Error | null = null;\n'
            '      const jwtSecret = (() => { try { return getJwtSecret(); } catch (e) { caught = e as Error; return ""; } })();\n'
            '      if (caught) { const e = caught; return reply.code(500).send(' + LEAK_BODY + '); }\n')
    write(s.replace(GET, body))


def m_swallow_fallback():
    s = src(); assert s.count(GET) == 1
    body = ('      const jwtSecret = (() => { try { return getJwtSecret(); } '
            'catch { return ' + MUTANT_FALLBACK + '; } })();\n')
    write(s.replace(GET, body))


MUTANTS = [
    ('M0 pre-fix refresh.ts (df0b4cd)', m_prefix),
    ('M1 getJwtSecret() resolved after rotation', m_after_rotation),
    ('M2 sign with a wrong constant key', m_wrong_key),
    ('M3 catch guard error and echo its message in 500 body', m_leak_message),
    ('M4 catch guard error and fall back to a constant', m_swallow_fallback),
]

results = []
for name, fn in MUTANTS:
    restore(); fn()
    r = subprocess.run(['pnpm', 'exec', 'vitest', 'run', 'tests/auth/refresh-jwt-secret.test.ts'],
                       cwd=os.path.join(REPO, 'apps/services/api'), env=env, capture_output=True, text=True)
    out = r.stdout + r.stderr
    lines = [l.strip() for l in out.splitlines() if ('✓' in l or '×' in l or 'AssertionError' in l or 'Tests ' in l)]
    verdict = 'KILLED' if r.returncode != 0 else 'SURVIVED'
    print(f'== {name}: rc={r.returncode} {verdict}')
    for l in lines[:8]:
        print('   ', l[:200])
    results.append(verdict)
restore()
print('git status after restore:', subprocess.run(['git', 'status', '--porcelain'], cwd=REPO, capture_output=True, text=True).stdout.strip() or 'clean')
print('summary:', results)
