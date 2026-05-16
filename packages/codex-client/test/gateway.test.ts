import { describe, expect, test } from "bun:test";
import {
	CodexGatewayClient,
	CodexGatewayProtocolServer,
	type CodexGatewayAppServer,
	type CodexGatewayPeer,
} from "../src/gateway/index.ts";
import { CodexEventEmitter } from "../src/app-server/events.ts";
import type {
	JsonRpcId,
	JsonRpcNotification,
	JsonRpcResponse,
} from "../src/app-server/rpc.ts";

describe("Codex gateway protocol", () => {
	test("server proxies appServer.call without interpreting native app-server methods", async () => {
		const appServer = new FakeAppServer();
		const server = new CodexGatewayProtocolServer({ appServer });
		const peer = new MemoryPeer();
		server.addPeer(peer);

		await server.handleMessage(peer, JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "appServer.call",
			params: {
				method: "thread/list",
				params: { limit: 2 },
			},
		}));

		expect(appServer.requests).toEqual([
			{ method: "thread/list", params: { limit: 2 } },
		]);
		expect(peer.response(1)?.result).toEqual({
			method: "thread/list",
			params: { limit: 2 },
		});
	});

	test("server declares gateway-owned commands but does not fake implementations", async () => {
		const appServer = new FakeAppServer();
		const server = new CodexGatewayProtocolServer({ appServer });
		const peer = new MemoryPeer();
		server.addPeer(peer);

		await server.handleMessage(peer, JSON.stringify({
			jsonrpc: "2.0",
			id: "delegation",
			method: "gateway.delegation.start",
			params: { prompt: "do work" },
		}));

		expect(appServer.requests).toEqual([]);
		expect(peer.response("delegation")?.error?.code).toBe(-32601);
		expect(peer.notifications("gateway.event")).toContainEqual(
			expect.objectContaining({
				method: "gateway.event",
				params: {
					event: expect.objectContaining({
						type: "unsupportedGatewayCommand",
						method: "gateway.delegation.start",
					}),
				},
			}),
		);
	});

	test("server proxies appServer.notify notifications without a response", async () => {
		const appServer = new FakeAppServer();
		const server = new CodexGatewayProtocolServer({ appServer });
		const peer = new MemoryPeer();

		await server.handleMessage(peer, JSON.stringify({
			jsonrpc: "2.0",
			method: "appServer.notify",
			params: {
				method: "initialized",
				params: { ok: true },
			},
		}));

		expect(appServer.notifications).toEqual([
			{ method: "initialized", params: { ok: true } },
		]);
		expect(peer.messages).toEqual([]);
	});

	test("client uses appServer.call for native helpers and unwraps app-server notifications", async () => {
		const transport = new FakeGatewayTransport();
		const client = new CodexGatewayClient({
			transport,
			clientName: "test-web",
			clientTitle: "Test Web",
			clientVersion: "0.1.0",
		});
		const notifications: JsonRpcNotification[] = [];
		client.on("notification", (message) => notifications.push(message));

		await client.connect();
		await client.listThreads({ limit: 5, sourceKinds: [] });
		client.notify("initialized", { ok: true });
		transport.emit("notification", {
			jsonrpc: "2.0",
			method: "appServer.notification",
			params: {
				message: {
					jsonrpc: "2.0",
					method: "turn/completed",
					params: { threadId: "thread-1" },
				},
			},
		});

		expect(transport.requests).toEqual([
			{
				method: "gateway.initialize",
				params: {
					clientInfo: {
						name: "test-web",
						title: "Test Web",
						version: "0.1.0",
					},
					capabilities: {
						appServerPassThrough: true,
					},
				},
			},
			{
				method: "appServer.call",
				params: {
					method: "thread/list",
					params: { limit: 5, sourceKinds: [] },
				},
			},
			{
				method: "appServer.notify",
				params: {
					method: "initialized",
					params: { ok: true },
				},
			},
		]);
		expect(notifications).toEqual([
			{
				jsonrpc: "2.0",
				method: "turn/completed",
				params: { threadId: "thread-1" },
			},
		]);
	});
});

class FakeAppServer extends CodexEventEmitter implements CodexGatewayAppServer {
	requests: Array<{ method: string; params?: unknown }> = [];
	notifications: Array<{ method: string; params?: unknown }> = [];
	responses: Array<{ id: JsonRpcId; result: unknown }> = [];
	responseErrors: Array<{
		id: JsonRpcId;
		code: number;
		message: string;
		data?: unknown;
	}> = [];

	async request<T = unknown>(method: string, params?: unknown): Promise<T> {
		this.requests.push({ method, params });
		return { method, params } as T;
	}

	notify(method: string, params?: unknown): void {
		this.notifications.push({ method, params });
	}

	respond(id: JsonRpcId, result: unknown): void {
		this.responses.push({ id, result });
	}

	respondError(
		id: JsonRpcId,
		code: number,
		message: string,
		data?: unknown,
	): void {
		this.responseErrors.push({ id, code, message, data });
	}
}

class MemoryPeer implements CodexGatewayPeer {
	messages: unknown[] = [];

	send(message: string): void {
		this.messages.push(JSON.parse(message) as unknown);
	}

	response(id: JsonRpcId): JsonRpcResponse | undefined {
		return this.messages.find((message): message is JsonRpcResponse =>
			isRecord(message) && message.id === id
		);
	}

	notifications(method: string): JsonRpcNotification[] {
		return this.messages.filter((message): message is JsonRpcNotification =>
			isRecord(message) && !("id" in message) && message.method === method
		);
	}
}

class FakeGatewayTransport extends CodexEventEmitter {
	readonly requestTimeoutMs = 60_000;
	requests: Array<{ method: string; params?: unknown }> = [];
	started = false;

	start(): void {
		this.started = true;
	}

	close(): void {
		this.started = false;
	}

	async request<T = unknown>(method: string, params?: unknown): Promise<T> {
		this.requests.push({ method, params });
		if (method === "gateway.initialize") {
			return {
				ok: true,
				serverInfo: { name: "fake", version: "0.1.0" },
				capabilities: {
					appServerPassThrough: true,
					gatewayCommands: [],
					flowInspection: false,
				},
			} as T;
		}
		return {} as T;
	}

	notify(method: string, params?: unknown): void {
		this.requests.push({ method, params });
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
