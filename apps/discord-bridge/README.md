# Codex Discord Bridge

Long-lived Discord sidecar for connecting Discord to Codex app-server threads.

## Gateway Mode

Gateway mode is opt-in. It keeps one Discord home channel as the primary UX and
one main Codex thread as the operator memory for the gateway. Legacy
thread-per-task behavior remains available outside the configured home channel.

Set these environment values before starting the bridge:

```bash
CODEX_DISCORD_HOME_CHANNEL_ID=1502107617512919220
CODEX_DISCORD_MAIN_THREAD_ID=019e2509-ddbb-7380-b97b-41575092d86b
CODEX_DISCORD_ALLOWED_CHANNEL_IDS=1502107617512919220
CODEX_DISCORD_DIR=/home/peezy/codex-fork-workspace/codex-flows
CODEX_FLOW_BACKEND_URL=http://127.0.0.1:8090
CODEX_DISCORD_HOOK_SPOOL_DIR=/home/peezy/.codex/discord-bridge/stop-hooks
```

`CODEX_DISCORD_MAIN_THREAD_ID` is optional. If omitted, the bridge creates a new
main operator thread, attaches the privileged gateway tools to it, and stores it
in the bridge state file. Existing configured main threads are resumed as-is;
recreate the main operator thread if you need to attach gateway tools to a
thread that predates gateway mode.

In the home channel:

- normal messages are sent to the main operator thread
- bot mentions are treated as gateway messages and do not create Discord task
  threads
- `status` replies directly with gateway state instead of starting a Codex turn

The prompt sent to the main thread uses `[discord-gateway]` framing so the model
knows it is operating as the gateway over the codex-flows backend, not as a
single task thread.

## Delegation Tools

Discord should not become a workspace registry. The main operator thread is the
place where routing decisions happen. Privileged `codex_gateway` dynamic tools
are attached only to that main thread and expose:

- `list_delegations`
- `start_delegation`
- `resume_delegation`
- `send_delegation`
- `read_delegation`
- `set_delegation_policy`
- `flush_delegation_results`
- `list_delegation_groups`
- `list_flow_runs`
- `list_flow_events`

Those tools can:

- list tracked delegated Codex sessions and backend runs/events
- start a delegated Codex session in a requested cwd
- resume a delegated Codex session by thread id
- send a turn to a delegated session
- observe or summarize delegated session state
- group delegations for fan-out/fan-in coordination
- record completed delegation results into the main operator thread
- inspect flow backend state through `CODEX_FLOW_BACKEND_URL`

Gateway state stores delegation records, including optional Discord detail
thread ids for noisy work. Delegated Codex sessions do not receive the privileged
gateway tools; only the main operator thread can manage delegation.

Delegations support return modes:

- `wake_on_done`: inject and mirror the result, then wake the main operator when idle
- `wake_on_group`: inject and mirror each result, then wake once the whole group is terminal
- `record_only`: inject and mirror results without waking the main operator
- `manual`: keep results in gateway state until `flush_delegation_results`
- `detached`: do not loop results back to the main thread; useful for human-continued threads

Automatic result return uses `thread/inject_items` to append structured
delegation results to the main operator thread's model-visible history. Codex
`Stop` hooks, not background thread polling, drive automatic result return:
the global hook writes durable Stop events into the spool directory, and the
gateway drains that spool on startup and while running. Starting a main-thread
turn is a separate wake step, so long-running main goals are not interrupted;
wakes are queued until the main operator thread is idle.

## Codex Stop Hook

Install the global hook once for the Codex runtime that backs the gateway:

```bash
codex-discord-bridge hook install
```

The bridge and hook default to `~/.codex/discord-bridge/stop-hooks`; override
both with `CODEX_DISCORD_HOOK_SPOOL_DIR` or `--hook-spool-dir` if needed.

The installer enables the current hooks feature in `~/.codex/config.toml`:

```toml
[features]
hooks = true
```

It also registers the Stop hook in `~/.codex/hooks.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "codex-discord-bridge hook stop",
            "timeout": 10,
            "statusMessage": "Recording Discord gateway Stop event"
          }
        ]
      }
    ]
  }
}
```

For package-on-demand installs, write a `bunx` command instead:

```bash
codex-discord-bridge hook install --bunx
codex-discord-bridge hook install --bunx-package @peezy.tech/codex-flows
```

The hook is intentionally dumb: it does not read gateway state or call the
backend. It only writes idempotent Stop-event files. The gateway ignores unknown
sessions, treats known delegated sessions according to their return mode, and
uses main-operator Stop events to drain queued wakes.

After changing hook configuration, restart the Codex runtime that backs the
gateway and trust the hook when Codex asks for review. `hooks/list` should show
the hook as `trusted`; untrusted hooks are discovered but do not run.
