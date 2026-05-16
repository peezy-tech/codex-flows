#!/usr/bin/env bun
import {
	CodexAppServerClient,
	CodexStdioTransport,
} from "@peezy.tech/codex-flows";
import {
	CodexGatewayProtocolServer,
	type CodexGatewayPeer,
} from "@peezy.tech/codex-flows/gateway";

import { parseArgs, type GatewayCliArgs } from "./args.ts";

const defaultAppServerUrl = "ws://127.0.0.1:3585";

async function main(): Promise<void> {
	const parsed = parseArgs(Bun.argv.slice(2), process.env);
	if (parsed.type === "help") {
		process.stdout.write(parsed.text);
		return;
	}

	const client = createAppServerClient(parsed);
	client.on("stderr", (line) => process.stderr.write(`${line}\n`));
	await client.connect();

	const gateway = new CodexGatewayProtocolServer({
		appServer: client,
		serverName: "codex-gateway-local",
		serverVersion: "0.1.0",
	});
	const peers = new WeakMap<Bun.ServerWebSocket<unknown>, CodexGatewayPeer>();
	const server = Bun.serve({
		hostname: parsed.hostname,
		port: parsed.port,
		fetch(request, bunServer) {
			if (bunServer.upgrade(request)) {
				return undefined;
			}
			return new Response("Codex gateway WebSocket server\n", {
				status: 426,
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		},
		websocket: {
			open(socket) {
				const peer: CodexGatewayPeer = {
					send: (message) => socket.send(message),
				};
				peers.set(socket, peer);
				gateway.addPeer(peer);
			},
			message(socket, message) {
				const peer = peers.get(socket);
				if (!peer) {
					return;
				}
				void gateway.handleMessage(peer, websocketMessageToString(message))
					.catch((error: unknown) => {
						gateway.sendGatewayEvent(peer, {
							type: "appServer.error",
							at: new Date().toISOString(),
							message: errorMessage(error),
						});
					});
			},
			close(socket) {
				const peer = peers.get(socket);
				if (peer) {
					gateway.removePeer(peer);
					peers.delete(socket);
				}
			},
		},
	});

	process.stdout.write(
		`codex-gateway-local listening on ws://${server.hostname}:${server.port}\n`,
	);
	process.stdout.write(
		`codex-gateway-local app-server ${
			parsed.localAppServer
				? "local stdio"
				: parsed.appServerUrl ??
					process.env.CODEX_WORKSPACE_APP_SERVER_WS_URL ??
					defaultAppServerUrl
		}\n`,
	);

	await waitForShutdown(server, client);
}

function createAppServerClient(
	args: Extract<GatewayCliArgs, { type: "serve" }>,
): CodexAppServerClient {
	const appServerUrl =
		args.appServerUrl ??
		process.env.CODEX_WORKSPACE_APP_SERVER_WS_URL ??
		defaultAppServerUrl;
	return new CodexAppServerClient({
		transport: args.localAppServer
			? new CodexStdioTransport({
					args: localAppServerArgs(),
					requestTimeoutMs: 90_000,
				})
			: undefined,
		webSocketTransportOptions: args.localAppServer
			? undefined
			: { url: appServerUrl, requestTimeoutMs: 90_000 },
		clientName: "codex-gateway-local",
		clientTitle: "Codex Gateway Local",
		clientVersion: "0.1.0",
	});
}

function localAppServerArgs(): string[] {
	return [
		"app-server",
		"--listen",
		"stdio://",
		"--enable",
		"apps",
		"--enable",
		"hooks",
	];
}

function websocketMessageToString(message: string | Buffer): string {
	return typeof message === "string" ? message : message.toString("utf8");
}

function waitForShutdown(
	server: Bun.Server<unknown>,
	client: CodexAppServerClient,
): Promise<void> {
	return new Promise((resolve) => {
		const shutdown = () => {
			process.off("SIGINT", shutdown);
			process.off("SIGTERM", shutdown);
			server.stop(true);
			client.close();
			resolve();
		};
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

await main();
