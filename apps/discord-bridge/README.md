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
```

`CODEX_DISCORD_MAIN_THREAD_ID` is optional. If omitted, the bridge creates a new
main operator thread and stores it in the bridge state file.

In the home channel:

- normal messages are sent to the main operator thread
- bot mentions are treated as gateway messages and do not create Discord task
  threads
- `status` replies directly with gateway state instead of starting a Codex turn

The prompt sent to the main thread uses `[discord-gateway]` framing so the model
knows it is operating as the gateway over the codex-flows backend, not as a
single task thread.

## Delegation Direction

Discord should not become a workspace registry. The main operator thread is the
place where routing decisions happen. Future privileged backend or MCP tools
should be attached only to that main thread and expose operations such as:

- list active Codex sessions or backend runs
- start a delegated Codex session in a requested cwd
- resume a delegated Codex session by thread id
- send a turn to a delegated session
- observe or summarize delegated session state
- dispatch, inspect, or replay flow backend events

Gateway state already has delegation records for those future tools, including
optional Discord detail thread ids for noisy work. Final results should return
to the home channel even when detail threads are used.
