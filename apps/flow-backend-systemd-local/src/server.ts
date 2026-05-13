import path from "node:path";
import type { FlowBackendConfig } from "./config.ts";
import { dispatchFlowEvent, normalizeFlowEvent } from "./backend.ts";
import { requestSignature, verifyBodySignature } from "./signature.ts";
import { FlowBackendStore } from "./store.ts";

export function serveFlowBackend(config: FlowBackendConfig): ReturnType<typeof Bun.serve> {
	const store = new FlowBackendStore(path.join(config.dataDir, "flow-backend.sqlite"));
	return Bun.serve({
		hostname: config.host,
		port: config.port,
		async fetch(request) {
			const url = new URL(request.url);
			if (request.method === "GET" && url.pathname === "/healthz") {
				return json({ ok: true });
			}
			if (request.method === "POST" && (url.pathname === "/events" || url.pathname === "/flow-events")) {
				const body = await request.text();
				if (config.secret && !verifyBodySignature(config.secret, body, requestSignature(request.headers))) {
					return json({ error: "invalid signature" }, 401);
				}
				const event = normalizeFlowEvent(JSON.parse(body) as unknown);
				const result = await dispatchFlowEvent({ config, store, event });
				return json(result, 202);
			}
			if (request.method === "GET" && url.pathname === "/runs") {
				const eventId = url.searchParams.get("eventId");
				if (!eventId) {
					return json({ error: "missing eventId" }, 400);
				}
				return json({ eventId, runs: store.listRunsByEvent(eventId) });
			}
			return json({ error: "not found" }, 404);
		},
	});
}

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value, null, 2), {
		status,
		headers: { "content-type": "application/json" },
	});
}
