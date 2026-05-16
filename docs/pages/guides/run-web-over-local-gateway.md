---
title: Run web over the local gateway
description: Start the browser UI through codex-gateway-local instead of a direct app-server WebSocket.
---

# Run web over the local gateway

Use the local gateway when the browser UI should share the same backend boundary
as Discord: the UI is a presenter/client, the gateway owns orchestration, and
the Codex app-server remains the source of truth for native app-server methods.

## Start the gateway

Connect the gateway to an existing app-server WebSocket:

```sh
bun apps/gateway/src/index.ts serve --app-server-url ws://127.0.0.1:3585
```

Or let the gateway start a local stdio app-server:

```sh
bun apps/gateway/src/index.ts serve --local-app-server
```

The gateway listens on `ws://127.0.0.1:3586` by default. Override it with
`--host`, `--port`, `CODEX_GATEWAY_HOST`, or `CODEX_GATEWAY_PORT`.

## Start the browser UI

```sh
bun run dev:web
```

The Vite dev server proxies `ws://<web-host>/__codex-gateway` to
`ws://127.0.0.1:3586`. Set `VITE_CODEX_GATEWAY_PROXY_TARGET` if the gateway is
on another host or port.

For a browser that should connect directly to a gateway WebSocket instead of
using the dev proxy, set `VITE_CODEX_GATEWAY_WS_URL`.

## Boundary

The web client uses `CodexGatewayClient`. Native app-server operations such as
thread listing, thread reads, thread starts, turn starts, turn interrupts, auth,
and account reads are sent through `appServer.call` and forwarded by the
gateway.

Do not reimplement app-server behavior in the gateway just to serve the web UI.
Add gateway-owned methods only for behavior that combines app-server state with
gateway state or policy, such as delegations, workbench routing, hook-spool
wakes, persisted gateway sessions, or read-only flow backend inspection.
