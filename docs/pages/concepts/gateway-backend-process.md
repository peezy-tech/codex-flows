---
title: Gateway backend process
description: Process boundaries for local and future remote Codex gateway backends.
---

# Gateway backend process

The current Discord gateway backend runs in-process with the Discord transport.
That keeps deployment simple while preserving the backend boundary in code:

- `DiscordCodexBridge` owns Discord startup, shutdown, command registration, and
  inbound dispatch.
- `LocalCodexGatewayBackend` owns app-server connection, Codex thread lifecycle,
  turn routing, goals, delegations, workbench state, hook-spool draining, and
  persisted gateway state.
- `CodexGatewayPresenter` is the only outbound UI surface the local backend
  receives. It can create posts or threads, send and update messages, pin status,
  type, and delete presentation artifacts.

## In-process local backend

Local mode is the first implementation. The Discord process constructs a local
backend with:

- a Codex app-server client
- a state store
- bridge configuration
- a presenter adapter backed by the Discord transport
- an optional flow backend client for read-only run and event inspection

The backend may connect to an existing app-server WebSocket or to a local stdio
app-server started by the CLI.

## Browser gateway process

The browser UI talks to the standalone local gateway server instead of talking
directly to the Codex app-server. In development, Vite proxies
`/__codex-gateway` to `codex-gateway-local` on port `3586`.

The browser gateway protocol has two lanes:

| Lane | Methods | Owner |
|------|---------|-------|
| app-server pass-through | `appServer.call`, `appServer.notify`, `appServer.respond`, `appServer.respondError` | Codex app-server |
| gateway-owned | `gateway.*` methods and `gateway.event` notifications | Codex gateway backend |

Native app-server methods stay native. For example, `thread/list`,
`thread/read`, `thread/start`, `turn/start`, `turn/interrupt`,
`account/read`, and app-server-native goal APIs are wrapped in
`appServer.call` and forwarded to the app-server. The gateway may observe,
route, and correlate those calls, but it should not duplicate their semantics.

Gateway-owned methods are for orchestration that the app-server does not own:
delegations, return modes, group wakes, workbench/workspace routing,
hook-spool observed-thread wake behavior, persisted gateway/session state, and
optional read-only flow backend inspection.

## Remote backend

A remote backend can implement the same `CodexGatewayBackend` shape behind HTTP
or WebSocket. The transport-facing protocol should stay small:

| Direction | Shape | Purpose |
|-----------|-------|---------|
| transport to backend | transport-specific inbound events or browser gateway JSON-RPC | lifecycle, commands, and event delivery |
| backend to transport | `CodexGatewayPresenter` operations or `gateway.event` notifications | UI output and presentation updates |
| backend to app-server | Codex app-server client calls | app-server-native thread, turn, auth, goal, and tool behavior |
| backend to flow backend | `@peezy.tech/flow-runtime` backend client calls | optional read-only inspection |

Discord inbound events are still transport-shaped. The browser gateway protocol
is the first transport-neutral client lane; future surfaces should share that
shape where practical and add a presenter adapter only for UI output.

## Flow backend boundary

This gateway backend is not a codex-flow backend. It may inspect flow runs and
events, but it must not own `FlowEvent`, `flow.toml`, `FLOW_RESULT`, matching,
or step execution.
