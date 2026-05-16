---
title: Gateway backends
description: How Codex gateway surfaces differ from generic flow backends.
---

# Gateway backends

A Codex gateway backend is the runtime behind an operator surface such as
Discord or the browser UI. It owns Codex app-server orchestration and exposes a
small UI-facing contract to the transport.

The Discord bridge is the first transport using this split:

- Discord owns bot login, commands, interactions, Discord channels, and message
  delivery.
- The gateway backend owns app-server connection, delegations, workbench state,
  hook-spool draining, persisted bridge/session state, and optional flow-run
  inspection.
- The local backend is the first implementation. It can connect to an existing
  app-server WebSocket or start a local stdio app-server.

The browser UI uses the same split. Its gateway client sends native app-server
methods through `appServer.call`, `appServer.notify`, `appServer.respond`, and
`appServer.respondError`. The gateway forwards those calls instead of
reimplementing app-server behavior for thread list/read, thread start/resume,
turn start/steer/interrupt, auth, account state, and app-server-native goal
APIs.

Gateway-owned commands are reserved for behavior that combines app-server state
with gateway policy or gateway state: delegation, return modes, group wakes,
workbench/workspace routing, hook-spool observed-thread wake behavior, persisted
gateway sessions, and read-only flow backend inspection.

This is separate from codex-flow backends. A flow backend accepts `FlowEvent`,
matches `flow.toml`, executes steps, records `FLOW_RESULT`, and exposes run and
event views. A gateway backend may read those run and event views, but it does
not redefine the flow ABI and should not become the generic flow executor.

Use a gateway backend when the product needs a long-lived Codex control surface.
Use a flow backend when the product needs portable event-driven automation.
