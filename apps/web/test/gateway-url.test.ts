import { describe, expect, test } from "bun:test";

import {
	gatewayStorageKey,
	initialGatewayWsUrl,
	proxiedGatewayWsUrl,
} from "../src/gateway-url.ts";

describe("gateway URLs", () => {
	test("uses the proxied gateway path on http origins", () => {
		expect(proxiedGatewayWsUrl({ protocol: "http:", host: "localhost:5173" }))
			.toBe("ws://localhost:5173/__codex-gateway");
	});

	test("uses wss for https origins", () => {
		expect(proxiedGatewayWsUrl({ protocol: "https:", host: "flows.peezy.tech" }))
			.toBe("wss://flows.peezy.tech/__codex-gateway");
	});

	test("prefers stored gateway URLs over env defaults", () => {
		const values = new Map<string, string>([
			[gatewayStorageKey, "ws://127.0.0.1:4599"],
		]);
		expect(
			initialGatewayWsUrl({
				envUrl: "ws://127.0.0.1:3586",
				location: { protocol: "http:", host: "localhost:5173" },
				storage: { getItem: (key) => values.get(key) ?? null },
			}),
		).toBe("ws://127.0.0.1:4599");
	});

	test("uses env defaults before deriving the proxied URL", () => {
		expect(
			initialGatewayWsUrl({
				envUrl: "ws://127.0.0.1:3586",
				location: { protocol: "http:", host: "localhost:5173" },
			}),
		).toBe("ws://127.0.0.1:3586");
	});
});
