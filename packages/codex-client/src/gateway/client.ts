import type { v2 } from "../app-server/generated/index.ts";
import { CodexEventEmitter } from "../app-server/events.ts";
import type { JsonRpcId } from "../app-server/rpc.ts";
import {
	CodexWebSocketTransport,
	type CodexWebSocketTransportOptions,
} from "../app-server/websocket-transport.ts";
import {
	APP_SERVER_CALL_METHOD,
	APP_SERVER_NOTIFICATION_METHOD,
	APP_SERVER_NOTIFY_METHOD,
	APP_SERVER_REQUEST_METHOD,
	APP_SERVER_RESPOND_ERROR_METHOD,
	APP_SERVER_RESPOND_METHOD,
	GATEWAY_EVENT_METHOD,
	GATEWAY_INITIALIZE_METHOD,
	appServerNotificationParams,
	appServerRequestParams,
	gatewayEventParams,
	type GatewayEvent,
	type GatewayInitializeResponse,
} from "./protocol.ts";

export type CodexGatewayTransport = CodexEventEmitter & {
	readonly requestTimeoutMs: number;
	start(): void;
	close(): void;
	request<T = unknown>(method: string, params?: unknown): Promise<T>;
	notify(method: string, params?: unknown): void;
};

export type CodexGatewayClientOptions = {
	transport?: CodexGatewayTransport;
	webSocketTransportOptions?: CodexWebSocketTransportOptions;
	clientName?: string;
	clientTitle?: string;
	clientVersion?: string;
};

export class CodexGatewayClient extends CodexEventEmitter {
	readonly transport: CodexGatewayTransport;
	#clientName: string;
	#clientTitle: string | null;
	#clientVersion: string;
	#connected = false;

	constructor(options: CodexGatewayClientOptions = {}) {
		super();
		const url = options.webSocketTransportOptions?.url;
		if (!options.transport && !url) {
			throw new Error("A Codex gateway WebSocket URL is required");
		}
		this.transport =
			options.transport ??
			new CodexWebSocketTransport({
				url: url!,
				requestTimeoutMs: options.webSocketTransportOptions?.requestTimeoutMs,
			});
		this.#clientName = options.clientName ?? "codex-gateway-client";
		this.#clientTitle = options.clientTitle ?? "Codex Gateway Client";
		this.#clientVersion = options.clientVersion ?? "0.1.0";

		this.transport.on("notification", (message) => {
			if (message.method === APP_SERVER_NOTIFICATION_METHOD) {
				const params = appServerNotificationParams(message.params);
				if (params) {
					this.emit("notification", params.message);
				}
				return;
			}
			if (message.method === APP_SERVER_REQUEST_METHOD) {
				const params = appServerRequestParams(message.params);
				if (params) {
					this.emit("request", params.message);
				}
				return;
			}
			if (message.method === GATEWAY_EVENT_METHOD) {
				const params = gatewayEventParams(message.params);
				if (params) {
					this.emit("gatewayEvent", params.event);
				}
				return;
			}
			this.emit("notification", message);
		});
		this.transport.on("close", (code, reason) => this.emit("close", code, reason));
		this.transport.on("error", (error) => this.emit("error", error));
	}

	async connect(): Promise<void> {
		if (this.#connected) {
			return;
		}
		this.transport.start();
		await this.transport.request<GatewayInitializeResponse>(
			GATEWAY_INITIALIZE_METHOD,
			{
				clientInfo: {
					name: this.#clientName,
					title: this.#clientTitle,
					version: this.#clientVersion,
				},
				capabilities: {
					appServerPassThrough: true,
				},
			},
		);
		this.#connected = true;
	}

	close(): void {
		this.#connected = false;
		this.transport.close();
	}

	request<T = unknown>(method: string, params?: unknown): Promise<T> {
		return this.transport.request<T>(APP_SERVER_CALL_METHOD, { method, params });
	}

	notify(method: string, params?: unknown): void {
		this.transport.notify(APP_SERVER_NOTIFY_METHOD, { method, params });
	}

	respond(id: JsonRpcId, result: unknown): void {
		void this.transport.request(APP_SERVER_RESPOND_METHOD, { id, result })
			.catch((error: unknown) => this.emit("error", error));
	}

	respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
		void this.transport.request(APP_SERVER_RESPOND_ERROR_METHOD, {
			id,
			code,
			message,
			data,
		}).catch((error: unknown) => this.emit("error", error));
	}

	gatewayRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
		return this.transport.request<T>(method, params);
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

export type { GatewayEvent };
