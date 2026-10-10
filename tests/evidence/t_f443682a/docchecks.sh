#!/usr/bin/env bash
# QA doc-validation checks for docs/development/setup.md on origin/master (t_750423a5)
set -u
CL=/home/sap/.hermes/kanban/workspaces/t_750423a5/clone
cd "$CL"
D=docs/development/setup.md
step() { echo; echo "=== $* ==="; }

step "leftover dev processes"
pgrep -af "$CL" || echo "none"

step "Planned item 1: Docker Compose / Postgres absent"
git ls-files | grep -iE '(^|/)(docker-)?compose\.ya?ml$|Dockerfile' || echo "no compose/Dockerfile tracked"
git grep -nIE '"(pg|postgres|drizzle-orm/node-postgres|@neondatabase/serverless)"' -- '*package.json' || echo "no postgres driver dependency"
git grep -nI 'drizzle-orm/(node-)?postgres' -- '*.ts' || echo "no postgres drizzle import"

step "Planned item 2: db:seed absent"
git grep -nIE '"(db:)?seed[^"]*"\s*:' -- '*package.json' || echo "no seed script in any package.json"

step "Planned item 3: Swagger UI absent"
git grep -nIiE 'swagger-ui|@fastify/swagger|/docs\b|/documentation' -- 'apps/services/api/src' 'apps/services/api/package.json' || echo "no swagger ui registration/dependency"
git grep -nI 'openapi.json' -- apps/services/api/src | head -3

step "Known gap: no vite proxy"
grep -n 'proxy' apps/web/vite.config.ts || echo "no proxy in vite.config.ts"

step "Facts: engines/nvmrc/packageManager/scripts"
grep -nE '"node"|packageManager|"dev"|"test:e2e' package.json
cat .nvmrc
grep -nE '"(dev|start|migrate|migrate:generate)"' apps/services/api/package.json
ls apps/services/api/migrations/*.sql

step "Facts: env vars read by API vs doc table"
git grep -nohE 'process\.env\.[A-Z_]+|env\.[A-Z_]{3,}' -- apps/services/api/src ':!*.test.ts' | sed -E 's/.*\.//' | sort -u
git grep -nI 'JWT_SECRET must be set in production' -- apps/services/api/src

step "Synthetic data: emails in doc"
grep -noE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+' $D | sort -u
step "Synthetic data: suspicious secret shapes in doc"
grep -nE '[A-Fa-f0-9]{32,}|eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{12,}|[0-9]{8,10}:AA[A-Za-z0-9_-]{20,}' $D || echo "no secret-shaped literals"
grep -nE 'JWT_SECRET=' $D
step "gitleaks on the doc (if available)"
command -v gitleaks && gitleaks dir $D --no-banner 2>&1 | tail -3 || echo "gitleaks not installed (CI secret-scan job covers master)"

step "Internal anchors resolve"
grep -oE '\]\(#[^)]+\)' $D | sort -u
grep -nE '^#{1,3} ' $D

step "README pointer"
grep -n 'development/setup.md' README.md
grep -n 'setup.md is planned' README.md || echo "old 'planned' sentence gone"

step "§7.4 nit: 'example value above'"
grep -n 'example value above' $D
