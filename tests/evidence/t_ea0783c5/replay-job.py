#!/usr/bin/env python3
"""Local replay of .github/workflows/qa-signoff-audit.yml (CI-001h evidence).

This is a miniature GitHub-Actions runner for ONE job of ONE workflow:

  * parses the real workflow file (no copy of the steps lives here),
  * resolves the handful of contexts the steps use (`github.*`, `inputs.*`,
    `steps.<id>.outputs.*`, `runner.temp`, `env.*`),
  * honours `if:` (`always()`, `steps.X.outputs.Y == 'true'`),
  * executes every `run:` step with bash, feeding a real GITHUB_OUTPUT /
    GITHUB_STEP_SUMMARY file, and simulates the `uses:` steps
    (checkout = the worktree already exists; setup-node/pnpm = no-op on this
    host; upload-artifact = copy the declared path).

It is NOT GitHub Actions: it proves the job's shell/step logic and the audit
integration against a real board. The macOS/Linux runner image, action
resolution and GitHub's own scheduling are outside its reach — the README marks
that boundary explicitly.

Usage: python3 replay-job.py <workflow.yml> <scenario>
Scenarios: board-present | no-board | dispatch-strict-history | dispatch-fixture-fail
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

WORKFLOW = Path(sys.argv[1])
SCENARIO = sys.argv[2]
REPO = WORKFLOW.resolve().parents[2]
HOME = Path.home()
EXPR = re.compile(r"\$\{\{\s*(.+?)\s*\}\}", re.S)


class Replay:
    def __init__(self, scenario, tmp):
        self.scenario = scenario
        self.tmp = Path(tmp)
        self.temp = self.tmp / "runner-temp"
        self.temp.mkdir(parents=True)
        self.runner_home = self.tmp / "home"
        self.runner_home.mkdir(parents=True)
        self.summary = self.temp / "step-summary.md"
        self.summary.write_text("")
        self.outputs = {}          # step id -> {key: value}
        self.artifacts = self.tmp / "artifacts"
        self.artifacts.mkdir()
        self.failed_steps = []
        self.log = []
        self.inputs = {}
        self.event = "schedule"
        self.hermes_db = str(self.tmp / "absent.db")

    # ── context resolution ────────────────────────────────────────────────
    def context(self, expr):
        expr = expr.strip()
        fixed = {
            "github.ref": "refs/heads/feature/t_ea0783c5",
            "github.event_name": self.event,
            "runner.temp": str(self.temp),
            "env.NODE_VERSION": "22",
            "env.PNPM_VERSION": "9.12.0",
        }
        if expr in fixed:
            return fixed[expr]
        m = re.fullmatch(r"inputs\.(\w+)", expr)
        if m:
            val = self.inputs.get(m.group(1), "")
            return "" if val is None else str(val)
        m = re.fullmatch(r"steps\.(\w+)\.outputs\.(\w+)", expr)
        if m:
            return self.outputs.get(m.group(1), {}).get(m.group(2), "")
        if expr.startswith("vars."):
            return ""  # no repo variable set for these scenarios
        raise SystemExit(f"replay: unresolved expression: {expr}")

    def render(self, text):
        return EXPR.sub(lambda m: self.context(m.group(1)), text)

    # ── execution ─────────────────────────────────────────────────────────
    def base_env(self):
        return {
            "PATH": os.environ["PATH"],
            "HOME": str(self.runner_home),
            "GITHUB_WORKSPACE": str(REPO),
            "RUNNER_TEMP": str(self.temp),
            "GITHUB_OUTPUT": str(self.temp / "github-output"),
            "GITHUB_STEP_SUMMARY": str(self.summary),
            "GITHUB_REF": "refs/heads/feature/t_ea0783c5",
            "GITHUB_EVENT_NAME": self.event,
            "HERMES_KANBAN_DB": self.hermes_db,
        }

    def run_step(self, step, wf_env):
        name = step.get("name") or step.get("uses", "")
        cond = step.get("if")
        if cond:
            cond = self.render(cond).strip()
            if cond != "always()" and not self.eval_cond(cond):
                self.log.append(f"  SKIP  {name}   (if: {cond})")
                return
        if "uses" in step:
            self.simulate_uses(step, name)
            return
        env = dict(self.base_env())
        env.update({k: self.render(str(v)) for k, v in wf_env.items()})
        env.update({k: self.render(str(v)) for k, v in (step.get("env") or {}).items()})
        env["GITHUB_STEP_NAME"] = name
        open(env["GITHUB_OUTPUT"], "w").close()
        script = self.render(step["run"])
        self.log.append(f"  RUN   {name}")
        self.log.append("        $ " + script.strip().splitlines()[0][:110])
        proc = subprocess.run(["bash", "-c", script], cwd=REPO, env=env,
                              capture_output=True, text=True)
        for line in (proc.stdout + proc.stderr).splitlines():
            self.log.append("        | " + line)
        self.log.append(f"        exit={proc.returncode}")
        # collect any outputs the step published
        for line in Path(env["GITHUB_OUTPUT"]).read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                self.outputs.setdefault(step["id"], {})[k] = v
        if proc.returncode != 0:
            self.failed_steps.append((name, proc.returncode))

    def eval_cond(self, cond):
        m = re.fullmatch(r"steps\.(\w+)\.outputs\.(\w+)\s*==\s*'([^']*)'", cond)
        if m:
            got = self.outputs.get(m.group(1), {}).get(m.group(2), "")
            return got == m.group(3)
        raise SystemExit(f"replay: unsupported if-condition: {cond}")

    def simulate_uses(self, step, name):
        uses = step["uses"]
        if uses.startswith("actions/checkout"):
            self.log.append(f"  SIM   {name} ({uses}) — repository already checked out at {REPO}")
        elif uses.startswith("actions/upload-artifact"):
            spec = self.render(str(step.get("with", {}).get("path", "")))
            found = list(self.tmp.glob("runner-temp/*")) if "runner-temp/*" in spec else [Path(spec)]
            found = [p for p in found if p.exists() and p.name != "step-summary.md"]
            dst = self.artifacts / step.get("with", {}).get("name", "artifact")
            dst.mkdir(exist_ok=True)
            for p in found:
                shutil.copy(p, dst / p.name)
            self.log.append(f"  SIM   {name} ({uses}) — artifact '{dst.name}': "
                            f"{[p.name for p in found] or 'NO FILES (if-no-files-found=' + str(step.get('with', {}).get('if-no-files-found')) + ')'}")
        else:
            self.log.append(f"  SIM   {name} ({uses}) — toolchain action, no-op on this host "
                            f"(node {subprocess.run(['node','--version'],capture_output=True,text=True).stdout.strip()} is already available)")


def scenario_inputs(scenario, tmp):
    """Board + inputs per scenario."""
    if scenario == "no-board":
        return {}, "", str(tmp / "no-such-home")
    if scenario == "board-present":
        return {}, str(HOME / ".hermes/kanban.db"), str(HOME)
    if scenario == "dispatch-strict-history":
        return {"board_db": str(HOME / ".hermes/kanban.db"), "strict_history": "true"}, str(HOME / ".hermes/kanban.db"), str(HOME)
    if scenario == "dispatch-fixture-fail":
        fixture = tmp / "fixture-board.db"
        shutil.copy(HOME / ".hermes/kanban.db", fixture)
        subprocess.run(["sqlite3", str(fixture),
                        "INSERT INTO tasks (id,title,assignee,status,body,created_at,completed_at) "
                        "VALUES ('t_deadbeef','CI-001h replay fixture: post-epoch card with no verdict and no evidence',"
                        "'backend','done','No QA verdict, no evidence, completed after the gate epoch.',"
                        f"{int(__import__('time').time())},{int(__import__('time').time())});"], check=True)
        return {"board_db": str(fixture), "strict_history": "false"}, str(fixture), str(HOME)
    raise SystemExit(f"unknown scenario {scenario}")


def main():
    doc = yaml.safe_load(WORKFLOW.read_text())
    job = doc["jobs"]["qa-signoff-audit"]
    wf_env = doc.get("env", {})
    tmp = Path(tempfile.mkdtemp(prefix="qa-signoff-replay-"))
    r = Replay(SCENARIO, tmp)
    inputs, hermes_db, home = scenario_inputs(SCENARIO, tmp)
    r.inputs = inputs
    r.hermes_db = hermes_db
    r.event = "schedule" if SCENARIO in ("board-present", "no-board") else "workflow_dispatch"
    r.runner_home = Path(home)
    r.runner_home.mkdir(parents=True, exist_ok=True)

    print(f"=== replay: {WORKFLOW.name} · scenario={SCENARIO} · event={r.event} ===")
    print(f"    job={job['name']}  steps={len(job['steps'])}  repo={REPO}")
    print(f"    inputs={inputs or '{}'}  HERMES_KANBAN_DB={hermes_db}  HOME={home}")
    for step in job["steps"]:
        r.run_step(step, wf_env)
    print("\n".join(r.log))
    print("\n=== run summary (GITHUB_STEP_SUMMARY) ===")
    print(r.summary.read_text())
    print("=== artifact dir ===")
    for p in sorted(r.artifacts.rglob("*")):
        print(f"    {p.relative_to(r.artifacts)}")
    result = "FAILURE" if r.failed_steps else "SUCCESS"
    print(f"\n=== job result: {result} ===")
    for n, c in r.failed_steps:
        print(f"    failing step: {n} (exit {c})")
    json.dump({"scenario": SCENARIO, "event": r.event, "inputs": inputs,
               "job_result": result, "failed_steps": r.failed_steps,
               "outputs": r.outputs},
              open(tmp / "result.json", "w"), indent=2)
    print(f"    scratch: {tmp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
