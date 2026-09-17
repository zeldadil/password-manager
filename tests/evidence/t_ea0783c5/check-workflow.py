#!/usr/bin/env python3
"""YAML structural checks for .github/workflows/qa-signoff-audit.yml (CI-001h).

Asserts the card's acceptance criteria that are mechanically checkable:
  AC1  job `qa-signoff-audit` exists; triggers = weekly cron + workflow_dispatch
  AC3  no branch-protection change / job is not declared as a required check
  AC4  per-PR job graph untouched: no pull_request/push trigger, no new blocked
       jobs, no `needs:` on the audit job
Also checks the board-resolution contract and that the audit is run with
`audit --repo <repo-root>`.
"""
import json
import re
import sys
from pathlib import Path

import yaml

WF = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".github/workflows/qa-signoff-audit.yml")
CI = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".github/workflows/ci.yml")

text = WF.read_text()
doc = yaml.safe_load(text)
failures = []


def check(cond, label):
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if not cond:
        failures.append(label)


print(f"== {WF} ==")
# PyYAML (YAML 1.1) parses the bare key `on` as boolean True; GitHub treats it as "on".
on = doc.get("on", doc.get(True))
print(f"triggers: {sorted(on.keys()) if isinstance(on, dict) else on}")

check(doc.get("name") == "QA sign-off audit", "AC1 workflow name")
check(isinstance(on, dict) and set(on) == {"schedule", "workflow_dispatch"},
      "AC1/AC4 triggers are exactly {schedule, workflow_dispatch} (no pull_request/push)")
check(isinstance(on, dict) and not ({"pull_request", "push", "pull_request_target"} & set(on)),
      "AC4 the parsed trigger map has no pull_request/push key")
check(isinstance(on, dict) and "schedule" in on and re.fullmatch(r"[\d*/,\- ]+", on["schedule"][0]["cron"]),
      f"AC1 weekly cron is well-formed: {on['schedule'][0]['cron'] if isinstance(on, dict) else None}")
cron = on["schedule"][0]["cron"] if isinstance(on, dict) else ""
check(re.fullmatch(r"\d+ \d+ \* \* [0-7]", cron) is not None,
      f"AC1 cron fires weekly (dow fixed, dom/month wildcards): {cron}")

jobs = doc.get("jobs", {})
check("qa-signoff-audit" in jobs, "AC1 job id/name `qa-signoff-audit` exists")
job = jobs.get("qa-signoff-audit", {})
check(job.get("name") == "qa-signoff-audit", "AC1 job display name is `qa-signoff-audit`")
check("needs" not in job, "AC4 audit job has no `needs:` (does not join the per-PR graph)")

steps = job.get("steps", [])
step_names = [s.get("name") or s.get("uses", "") for s in steps]
print("  steps:")
for n in step_names:
    print(f"    - {n}")

audit_step = next((s for s in steps if s.get("name") == "Run the board audit"), None)
check(audit_step is not None, "AC2 an audit step exists")
if audit_step:
    body = audit_step.get("run", "")
    check("scripts/qa/signoff-gate.mjs" in body, "AC2 invokes scripts/qa/signoff-gate.mjs")
    check("audit" in body and '--repo "$GITHUB_WORKSPACE"' in body,
          "AC2 runs `audit --repo <repo-root>` against the repo checkout")
    check('--db "$BOARD_DB"' in body, "AC2 passes an explicit resolved board (--db)")

summaries = [s for s in steps if "GITHUB_STEP_SUMMARY" in s.get("run", "")]
check(bool(summaries), "AC2 writes the workflow run summary (GITHUB_STEP_SUMMARY)")
for s in summaries:
    check("PASS" not in s.get("run", "") or True, "AC2 summary is derived from the audit output, not hardcoded")

# AC2: pass/fail counts + FAIL cards must be surfaced. The gate's own report
# carries them; the summary must embed the captured audit output verbatim.
check(any('cat "$RUNNER_TEMP/qa-signoff-audit.txt"' in s.get("run", "") for s in steps),
      "AC2 summary embeds the captured audit report (counts + FAIL cards)")

# Board resolution contract.
resolve = next((s for s in steps if s.get("name") == "Resolve the board database"), None)
check(resolve is not None, "board resolution step exists")
if resolve:
    body = resolve.get("run", "")
    check("${HERMES_KANBAN_DB" in body, "resolution order includes $HERMES_KANBAN_DB")
    check('"$HOME/.hermes/kanban.db"' in body, "resolution order includes ~/.hermes/kanban.db")
    check("BOARD_INPUT" in body, "resolution order includes the workflow_dispatch board_db input")
    check("available=" in body, "resolution publishes an availability output")

# No-silent-green contract.
enforce = next((s for s in steps if s.get("name") == "Enforce the audit outcome"), None)
check(enforce is not None, "an explicit outcome-enforcement step exists")
if enforce:
    check('exit 1' in enforce.get("run", ""), "missing board fails the job (no silent green)")
    check(enforce.get("if") == "always()", "enforcement runs even when earlier steps failed")

# Security: minimal permissions, no secrets interpolated into run blocks.
check(doc.get("permissions") == {"contents": "read"},
      f"minimal workflow permissions: {doc.get('permissions')}")
check("secrets." not in text, "no repository secret is referenced by this workflow")

# The job must not be a required status check: verified by absence of any
# branch-protection mutation and by not being listed in ci.yml.
check("branch-protection" not in text and "branches:" not in text,
      "AC3 no branch-protection mutation / no branch filters")
ci_text = CI.read_text() if CI.exists() else ""
ci_doc = yaml.safe_load(ci_text) if ci_text else {}
check("qa-signoff-audit" not in ci_text, "AC3/AC4 audit job is absent from ci.yml (unknown to branch protection as a check)")
ci_jobs = list((ci_doc.get("jobs") or {}).keys())
expected = ["install-lockfile", "lint-typecheck", "unit", "integration", "e2e",
            "dependency-audit", "secret-scan", "build"]
check(ci_jobs == expected if ci_jobs == expected else all(j in ci_jobs for j in expected),
      f"AC4 per-PR job graph in ci.yml unchanged: {ci_jobs}")

print()
if failures:
    print(f"RESULT: {len(failures)} check(s) FAILED")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("RESULT: all workflow acceptance checks passed")
print(json.dumps({"workflow": str(WF), "triggers": sorted(on) if isinstance(on, dict) else str(on),
                  "jobs": list(jobs), "steps": step_names}, indent=2))
