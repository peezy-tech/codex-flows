#!/usr/bin/env bun
import path from "node:path";
import { dispatchFlowEvent, readFlowEvent } from "./backend.ts";
import { helpText, parseCli } from "./config.ts";
import { serveFlowBackend } from "./server.ts";
import { FlowBackendStore } from "./store.ts";

await main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});

async function main(): Promise<void> {
	const cli = parseCli(Bun.argv.slice(2));
	if (cli.kind === "help") {
		process.stdout.write(helpText());
		return;
	}
	if (cli.kind === "serve") {
		const server = serveFlowBackend(cli.config);
		process.stdout.write(`codex-flow-systemd-local listening on http://${server.hostname}:${server.port}\n`);
		return new Promise(() => undefined);
	}
	const store = new FlowBackendStore(path.join(cli.config.dataDir, "flow-backend.sqlite"));
	try {
		const event = await readFlowEvent(cli.eventPath);
		const result = await dispatchFlowEvent({
			config: cli.config,
			store,
			event,
			wait: cli.wait,
			env: process.env,
		});
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} finally {
		store.close();
	}
}
