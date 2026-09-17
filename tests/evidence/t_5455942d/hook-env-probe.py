"""Reproduce the env a Hermes shell hook subprocess receives from a dispatcher worker.

Mirrors agent/shell_hooks.py::_spawn ->
tools.environments.local.build_subprocess_env(scrub_secrets=is_multiplex_active())
for the single-profile (non-multiplex) case, starting from a worker-like env.

Findings (t_5455942d): the hook subprocess does NOT see HERMES_KANBAN_TASK /
HERMES_KANBAN_RUN_ID / HERMES_KANBAN_CLAIM_LOCK — Hermes strips the kanban identity
keys from descendants (agent/delegation_context.py::scrub_kanban_env over
KANBAN_ENV_KEYS). HERMES_KANBAN_WORKSPACE / _BOARD / _DB survive, which is how the
gate resolves the card now (QA_SIGN_OFF_GATE.md §6.4).
"""
import os
import sys

sys.path.insert(0, "/home/sap/.hermes/hermes-agent")

# The dispatcher-set identity of a kanban worker (see
# hermes_cli/kanban_db_dispatch.py: env["HERMES_KANBAN_TASK"] = task.id).
os.environ["HERMES_KANBAN_TASK"] = "t_5455942d"
os.environ["HERMES_KANBAN_RUN_ID"] = "469"
os.environ["HERMES_KANBAN_CLAIM_LOCK"] = "ai-server:893"
os.environ["HERMES_KANBAN_WORKSPACE"] = "/home/sap/.hermes/kanban/workspaces/t_5455942d"
os.environ["HERMES_KANBAN_WORKSPACES_ROOT"] = "/home/sap/.hermes/kanban/workspaces"
os.environ["HERMES_KANBAN_DB"] = "/home/sap/.hermes/kanban.db"
os.environ["HERMES_SESSION_SOURCE"] = "kanban"

from tools.environments.local import build_subprocess_env  # noqa: E402

env = build_subprocess_env(scrub_secrets=False)
print("HERMES_KANBAN_TASK present in the hook's env:", "HERMES_KANBAN_TASK" in env)
print("HERMES_KANBAN_RUN_ID present in the hook's env:", "HERMES_KANBAN_RUN_ID" in env)
print("HERMES_DELEGATED_CHILD_CONTEXT:", env.get("HERMES_DELEGATED_CHILD_CONTEXT"))
print("--- every HERMES_* key the hook sees (credential-shaped values redacted) ---")
for k in sorted(env):
    if not k.startswith("HERMES_"):
        continue
    v = env[k]
    if any(t in k for t in ("SECRET", "PASSWORD", "TOKEN", "KEY")):
        print(f"{k}=<redacted, {len(v)} chars>")
    else:
        print(f"{k}={v}")
