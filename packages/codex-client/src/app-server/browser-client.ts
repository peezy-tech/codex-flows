import type { v2 } from "./generated/index.ts";
import { CodexEventEmitter } from "./events.ts";
import type { JsonRpcId } from "./rpc.ts";
import {
	CodexWebSocketTransport,
	type CodexWebSocketTransportOptions,
} from "./websocket-transport.ts";

export type CodexBrowserAppServerTransport = CodexEventEmitter & {
	readonly requestTimeoutMs: number;
	start(): void;
	close(): void;
	request<T = unknown>(method: string, params?: unknown): Promise<T>;
	notify(method: string, params?: unknown): void;
	respond(id: JsonRpcId, result: unknown): void;
	respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void;
};

export type CodexBrowserAppServerClientOptions = {
	transport?: CodexBrowserAppServerTransport;
	webSocketTransportOptions?: CodexWebSocketTransportOptions;
	clientName?: string;
	clientTitle?: string;
	clientVersion?: string;
};

export class CodexBrowserAppServerClient extends CodexEventEmitter {
	readonly transport: CodexBrowserAppServerTransport;
	#clientName: string;
	#clientTitle: string | null;
	#clientVersion: string;
	#connected = false;

	constructor(options: CodexBrowserAppServerClientOptions = {}) {
		super();
		const url = options.webSocketTransportOptions?.url;
		if (!options.transport && !url) {
			throw new Error("A Codex app-server WebSocket URL is required");
		}
		this.transport =
			options.transport ??
			new CodexWebSocketTransport({
				url: url!,
				requestTimeoutMs: options.webSocketTransportOptions?.requestTimeoutMs,
			});
		this.#clientName = options.clientName ?? "bare-web";
		this.#clientTitle = options.clientTitle ?? "Codex Bare Web";
		this.#clientVersion = options.clientVersion ?? "0.1.0";

		this.transport.on("notification", (message) =>
			this.emit("notification", message),
		);
		this.transport.on("request", (message) => this.emit("request", message));
		this.transport.on("close", (code, reason) => this.emit("close", code, reason));
		this.transport.on("error", (error) => this.emit("error", error));
	}

	async connect(): Promise<void> {
		if (this.#connected) {
			return;
		}
		this.transport.start();
		await this.request("initialize", {
			clientInfo: {
				name: this.#clientName,
				title: this.#clientTitle,
				version: this.#clientVersion,
			},
			capabilities: {
				experimentalApi: true,
			},
		});
		this.transport.notify("initialized");
		this.#connected = true;
	}

	close(): void {
		this.#connected = false;
		this.transport.close();
	}

	request<T = unknown>(method: string, params?: unknown): Promise<T> {
		return this.transport.request<T>(method, params);
	}

	respond(id: JsonRpcId, result: unknown): void {
		this.transport.respond(id, result);
	}

	respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
		this.transport.respondError(id, code, message, data);
	}

	startThread(
		params: v2.ThreadStartParams,
	): Promise<v2.ThreadStartResponse> {
		return this.request<v2.ThreadStartResponse>("thread/start", params);
	}

	resumeThread(
		params: v2.ThreadResumeParams,
	): Promise<v2.ThreadResumeResponse> {
		return this.request<v2.ThreadResumeResponse>("thread/resume", params);
	}

	listThreads(params: v2.ThreadListParams): Promise<v2.ThreadListResponse> {
		return this.request<v2.ThreadListResponse>("thread/list", params);
	}

	readThread(params: v2.ThreadReadParams): Promise<v2.ThreadReadResponse> {
		return this.request<v2.ThreadReadResponse>("thread/read", params);
	}

	injectThreadItems(
		params: v2.ThreadInjectItemsParams,
	): Promise<v2.ThreadInjectItemsResponse> {
		return this.request<v2.ThreadInjectItemsResponse>("thread/inject_items", params);
	}

	startTurn(params: v2.TurnStartParams): Promise<v2.TurnStartResponse> {
		return this.request<v2.TurnStartResponse>("turn/start", params);
	}

	steerTurn(params: v2.TurnSteerParams): Promise<v2.TurnSteerResponse> {
		return this.request<v2.TurnSteerResponse>("turn/steer", params);
	}

	interruptTurn(
		params: v2.TurnInterruptParams,
	): Promise<v2.TurnInterruptResponse> {
		return this.request<v2.TurnInterruptResponse>("turn/interrupt", params);
	}

	getAccount(
		params: v2.GetAccountParams = { refreshToken: false },
	): Promise<v2.GetAccountResponse> {
		return this.request<v2.GetAccountResponse>("account/read", params);
	}
}
