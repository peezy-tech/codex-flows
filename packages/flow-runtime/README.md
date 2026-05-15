# @peezy.tech/flow-runtime

Generic runtime primitives for Codex flow packages.

This package loads `flow.toml` manifests, matches generic events to flow steps,
validates JSON-schema payloads, and runs steps with the Bun or feature-flagged
Code Mode runners.

```ts
import { discoverFlows, matchingSteps, runFlowStep } from "@peezy.tech/flow-runtime";
```

## Backend Client

`@peezy.tech/flow-runtime/backend-client` exposes backend-native inspection and
control for generic flow state. It is intentionally separate from app-server
thread commands: runs, events, attempts, replay, cancel, output, and
`FLOW_RESULT` payloads belong to flow backends.

```ts
import { createFlowBackendHttpClient } from "@peezy.tech/flow-runtime/backend-client";

const backend = createFlowBackendHttpClient({
	baseUrl: "http://127.0.0.1:7345",
	bearerToken: process.env.CODEX_FLOW_BACKEND_TOKEN,
});

const { runs } = await backend.listRuns({ status: "completed", limit: 20 });
```

The client normalizes systemd-local, Convex-adapter, and codex-service-style
run/event responses into stable view models with `processStatus`,
`resultStatus`, `effectiveStatus`, `needsAttention`, attempts, latest output,
and result payload data. Semantic statuses such as `blocked` and
`needs_intervention` are read from `FLOW_RESULT` payloads when the backend
stores them separately from process status.

Code Mode steps remain gated. Enable them with:

```bash
CODEX_FLOWS_MODE=code-mode
```
