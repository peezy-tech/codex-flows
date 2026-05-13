# @peezy.tech/flow-runtime

Generic runtime primitives for Codex flow packages.

This package loads `flow.toml` manifests, matches generic events to flow steps,
validates JSON-schema payloads, and runs steps with the Bun or feature-flagged
Code Mode runners.

```ts
import { discoverFlows, matchingSteps, runFlowStep } from "@peezy.tech/flow-runtime";
```

Code Mode steps remain gated. Enable them with:

```bash
CODEX_FLOWS_MODE=code-mode
```
