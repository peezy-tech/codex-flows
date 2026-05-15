# Flow Backend Handoff - 2026-05-15

This handoff summarizes the flow-backend discussion so a fresh agent can continue without redoing the same repo archaeology.

## Repositories Discussed

- `codex-flows`: `/home/peezy/codex-fork-workspace/codex-flows`
- `protocol-mono`: `/home/peezy/load-game-workspace/protocol-mono`
- A mistaken path was checked first: `/home/peezy/game-protocol-workspace/protocol-mono`. It is not the active repo; it only contained a sparse `apps/web/.vite` directory and no Git checkout.

## codex-flows Backend Model

`codex-flows` has three relevant layers:

- `packages/flow-runtime`: shared runtime. It loads `flow.toml`, discovers `.codex/flows/*` before `flows/*`, validates event payloads against per-step JSON Schema, matches steps by trigger type, and executes steps with `runner = "bun"` or gated `runner = "code-mode"`.
- `apps/flow-runner`: CLI wrapper over the runtime. It lists flows, fires matching steps for an event, or runs one explicit step. It does not persist backend state.
- `apps/flow-backend-systemd-local`: the implemented local HTTP/CLI execution backend. It persists events/runs to SQLite, writes event JSON files, discovers matching steps, and starts `flow-runner` locally.

`systemd-local` has two executor modes:

- `CODEX_FLOW_BACKEND_EXECUTOR=direct`: spawn Bun directly.
- `CODEX_FLOW_BACKEND_EXECUTOR=systemd-run`: wrap each step in `systemd-run --user --wait --collect`.

Important behavior:

- Normal dispatch is idempotent by `event.id`; duplicates return existing run ids and do not start another attempt.
- Replay intentionally creates a new run attempt.
- Local run status is process-level: `queued`, `running`, `completed`, `failed`. Semantic flow result statuses such as `blocked` or `needs_intervention` live inside `resultJson`.
- Code Mode steps require `CODEX_FLOWS_MODE=code-mode` or `CODEX_FLOWS_ENABLE_CODE_MODE=1`.

The Convex package in `packages/flow-backend-convex` is a durable control-plane component, not an executor. It stores synced manifests, flow events, runs, attempts, leases, output chunks, and final results. External workers claim runs and execute `flow.toml` steps using `@peezy.tech/flow-runtime`.

Focused tests were run and passed:

```bash
bun test packages/flow-runtime/test/flow-runtime.test.ts apps/flow-backend-systemd-local/test/backend.test.ts packages/flow-backend-convex/test/backend-model.test.ts
```

Result: 16 pass, 0 fail.

## protocol-mono Usage

`protocol-mono` is primarily using the Convex backend option for the pet game.

Key files:

- `apps/pet-game/convex/convex.config.ts`: installs `@peezy.tech/flow-backend-convex` with `app.use(flowBackend)`.
- `apps/pet-game/convex/flowBackend.ts`: app-owned service-secret wrappers around the generic Convex component API.
- `apps/pet-game/convex/chain.ts`: records validated `GameTreasury.PaymentReceived` events and dispatches generic flow events.
- `apps/pet-game/src/worker/codexWorker.ts`: private worker that syncs local manifests, claims Convex runs, heartbeats, executes with `@peezy.tech/flow-runtime`, applies domain completion, and completes/fails the backend run.
- `apps/pet-game/flows/player-character-asset/flow.toml`: first app flow.
- `apps/pet-game/flows/player-character-asset/exec/generate-player-character.ts`: Bun step implementation that starts the Codex sprite-generation flow and emits `FLOW_RESULT`.

The payment-to-flow path is:

1. Browser creates a `generationRequests` row in Convex and returns payment payload data.
2. Wallet pays `GameTreasury`.
3. `chain-watcher` observes `PaymentReceived`.
4. `convex/chain.ts` validates chain/payment/source data.
5. It dispatches a generic `FlowEvent`:

```ts
{
  id: `pet-game:payment:${chainId}:${txHash}:${logIndex}`,
  type: "pet-game.player_asset_generation.requested",
  source: "pet-game.chain",
  payload: { requestId, source, characterName, installAsDefault, allowMirror, ... }
}
```

6. Convex flow backend creates queued run(s) from synced manifests.
7. `codexWorker.ts` claims the run, executes the matching local flow step, and heartbeats during execution.
8. On success, `codexWorker.ts` uploads generated outputs to `asset-service`, optionally mints, calls `convex/worker.ts::completeAssetFlowResult`, then calls `flowBackend.completeRun`.
9. On failure, it calls `failAssetFlowResult` and `flowBackend.failRun`.

`protocol-mono` also has `services/codex-service`, a separate protocol-wide HTTP/file-backed runner over `@peezy.tech/flow-runtime`. It has its own `/events`, `/runs`, retry/cancel, and worker loop. It is domain-neutral and can run the same flow packages, but the pet-game payment lifecycle described above is wired through Convex plus `codex-worker`.

## Discord Bridge Handling

`apps/discord-bridge` in `codex-flows` does not run flows and does not talk to the Convex component directly.

Its main role is a Discord-to-Codex app-server bridge:

- It mirrors Discord messages into Codex app-server threads.
- It mirrors progress/status/output back to Discord.
- In gateway mode, it gives the main Codex operator thread privileged `codex_gateway.*` dynamic tools.

For flow backend state, it exposes only two read-only tools:

- `codex_gateway.list_flow_runs`
- `codex_gateway.list_flow_events`

Configuration:

- `--flow-backend-url`
- `CODEX_FLOW_BACKEND_URL`
- `CODEX_GATEWAY_BACKEND_URL`

Flow inspection path:

```text
Discord user
  -> discord-bridge
  -> main Codex gateway thread
  -> dynamic tool call: codex_gateway.list_flow_runs
  -> discord-bridge calls FlowBackendHttpClient.listRuns()
  -> JSON returned to Codex
  -> Codex summarizes/responds in Discord
```

The bridge now uses `@peezy.tech/flow-runtime/backend-client` for the existing
read-only inspection tools:

- `FlowBackendClient.listRuns(...)`
- `FlowBackendClient.listEvents(...)`

It still does not expose Discord dispatch, replay, or cancel tools. When the
HTTP implementation is constructed from `CODEX_FLOW_BACKEND_URL`, it performs
inspection against the `/runs` and `/events` API; Convex consumers should expose
an app-owned HTTP adapter with appropriate service auth instead of importing
generated app-specific Convex APIs into a generic client.

If the goal is to let Discord inspect `protocol-mono` Convex flow state, the next increment should be one of:

- add a small HTTP adapter in `protocol-mono` that exposes `/runs` and `/events`
  in the normalized backend-client shape, with appropriate service auth; or
- configure the Discord bridge against an existing HTTP adapter such as
  `services/codex-service` when that service owns the relevant runs.

If the goal is dispatch/replay/cancel from Discord, the bridge would need new privileged tools. Today it only lists runs/events.

## Useful Follow-Up Checks

- Decide whether `services/codex-service` should become the shared HTTP adapter for Discord bridge inspection, or whether Convex should get its own small inspection gateway.
- If using `codex-service`, confirm whether its JSON response shape is close enough to `codex-flow-systemd-local` for bridge consumption.
- If adding bridge write tools, keep them restricted to the gateway main thread like the existing `codex_gateway.*` tools.
- Preserve the rule that generic backend state remains domain-neutral; pet-game completion should stay in app-owned Convex functions or worker adapters.
