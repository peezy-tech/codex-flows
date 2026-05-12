# Security

`codex-bare` is a browser UI for a Codex app-server WebSocket. It does not add
authentication, authorization, persistence, or request filtering in front of the
app-server.

Keep the app-server bound to localhost or another trusted network boundary. Do
not expose the app-server WebSocket directly to the public internet.
