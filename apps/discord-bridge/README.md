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
- `list_flow_runs`
- `list_flow_events`

Those tools can:

- list tracked delegated Codex sessions and backend runs/events
- start a delegated Codex session in a requested cwd
- resume a delegated Codex session by thread id
- send a turn to a delegated session
- observe or summarize delegated session state
- inspect flow backend state through `CODEX_FLOW_BACKEND_URL`

Gateway state stores delegation records, including optional Discord detail
thread ids for noisy work. Delegated Codex sessions do not receive the privileged
gateway tools; only the main operator thread can manage delegation.
