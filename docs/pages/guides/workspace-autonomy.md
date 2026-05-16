---
title: Workspace autonomy
description: Configure and run repo-native scheduled workspace tasks with codex-flows.
---

# Workspace autonomy

Workspace autonomy lets a repository schedule and run Codex-backed work without
inventing a second home, skill, or memory system. Repo-local control config and
generated state live under `.codex`.

```text
.codex/
  workspace.toml
  skills/
  memories/
  workspace/
    actions/
      state/
      runs/
      outputs/
      health/
    local/
      state/
      runs/
      outputs/
      health/
```

There is no root-level `workspace/` directory and no persistent `logs/`
directory in the v1 workspace autonomy layout.

## Modes

| Mode | When to use it | Runtime `CODEX_HOME` | Generated state |
|------|----------------|----------------------|-----------------|
| `auto` | Default selection | `actions` when `GITHUB_ACTIONS=true`, otherwise `local` | Depends on resolved mode |
| `local` | Developer machines | The active user/global Codex home | `.codex/workspace/local` |
| `actions` | CI or local CI simulation | `<repo>/.codex` | `.codex/workspace/actions` |

Local mode does not override the active Codex home. Actions mode intentionally
uses the repository `.codex` directory so scheduled CI work can use repo skills
and memories.

## Commands

```bash
codex-flows workspace doctor
codex-flows workspace tick --mode local
codex-flows workspace run morning-brief --mode actions
CODEX_WORKSPACE_MODE=actions codex-flows workspace doctor
```

`doctor` reports mode, repo root, config path, runtime `CODEX_HOME`, state
roots, task health, latest run, memory roots, memory summary presence, and
workspace backend status when reachable.

`tick` runs due scheduled tasks once and evaluates reactive rules.

`run <task-id>` runs one configured task immediately.

Existing JSON-RPC passthrough commands stay intact:

```bash
codex-flows workspace call <method>
codex-flows workspace app <method>
codex-flows workspace methods
```

## Config

Workspace control config lives at `.codex/workspace.toml`:

```toml
[workspace]
name = "meta-workspace"

[[workspace.surfaces]]
key = "default"
kind = "discord"
home_channel_id = "1504547371730862220"
workspace_forum_channel_id = "1504539961754648706"
task_threads_channel_id = "1504547308040229025"

[[workspace.tasks]]
id = "morning-brief"
enabled = true
kind = "skill"
skill = "morning-brief"
schedule = "0 14 * * *"
var = "workspace status"

[[workspace.reactive]]
id = "repair-failing-task"
enabled = true
task = "*"
consecutive_failures_gte = 3
kind = "skill"
skill = "skill-repair"
```

Task ids must be lowercase slug-like ids. Schedules use five-field cron syntax.

## Task Kinds

### `skill`

Runs a Codex skill.

Actions mode resolves skills from `.codex/skills/<skill>/SKILL.md` because
`CODEX_HOME` is the repository `.codex`. Local mode uses the active Codex home,
so a developer can run against their installed skills without mutating the repo
home.

```toml
[[workspace.tasks]]
id = "morning-brief"
enabled = true
kind = "skill"
skill = "morning-brief"
schedule = "0 14 * * *"
var = "workspace status"
```

### `flow`

Dispatches through the workspace backend flow capability.

```toml
[[workspace.tasks]]
id = "release-health"
enabled = true
kind = "flow"
flow = "workspace.release.health"
schedule = "*/30 * * * *"
```

### `command`

Runs an explicitly configured command. Use this for small, deliberate checks
where a full skill or flow would be unnecessary.

```toml
[[workspace.tasks]]
id = "bun-version"
enabled = true
kind = "command"
command = ["bun", "--version"]
schedule = "0 * * * *"
```

## Reactive Rules

Reactive rules inspect task health. A common pattern is to run a repair skill
after repeated failures:

```toml
[[workspace.reactive]]
id = "repair-failing-task"
enabled = true
task = "*"
consecutive_failures_gte = 3
kind = "skill"
skill = "skill-repair"
```

## GitHub Actions

Scheduler:

```bash
export CODEX_WORKSPACE_MODE=actions
export CODEX_HOME="$GITHUB_WORKSPACE/.codex"
codex-flows workspace tick --mode actions
```

Runner:

```bash
export CODEX_WORKSPACE_MODE=actions
export CODEX_HOME="$GITHUB_WORKSPACE/.codex"
codex-flows workspace run "$TASK_ID" --mode actions
```

Actions commits should be limited to:

```text
.codex/memories/
.codex/workspace/actions/
```

Use job logs for verbose logs. Local mode generated state should not be
committed.

## Discord Surfaces

Workspace autonomy reads `[[workspace.surfaces]]` from `.codex/workspace.toml`.
The current Discord bridge also has bridge-owned surface configuration described
in [Discord bridge](../reference/discord-bridge). Document and operate the
surface that the command you are running actually consumes.
