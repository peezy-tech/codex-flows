import type {
	JsonRpcId,
	JsonRpcNotification,
	JsonRpcRequest,
} from "../app-server/rpc.ts";

export const GATEWAY_INITIALIZE_METHOD = "gateway.initialize";
export const GATEWAY_EVENT_METHOD = "gateway.event";
export const APP_SERVER_CALL_METHOD = "appServer.call";
export const APP_SERVER_NOTIFY_METHOD = "appServer.notify";
export const APP_SERVER_RESPOND_METHOD = "appServer.respond";
export const APP_SERVER_RESPOND_ERROR_METHOD = "appServer.respondError";
export const APP_SERVER_NOTIFICATION_METHOD = "appServer.notification";
export const APP_SERVER_REQUEST_METHOD = "appServer.request";

export type GatewayInitializeParams = {
	clientInfo?: {
		name?: string;
		title?: string | null;
		version?: string;
	};
	capabilities?: Record<string, unknown>;
};

export type GatewayInitializeResponse = {
	ok: true;
	serverInfo: {
		name: string;
		version: string;
	};
	capabilities: {
		appServerPassThrough: true;
		gatewayCommands: string[];
		flowInspection: boolean;
	};
};

export type AppServerCallParams = {
	method: string;
	params?: unknown;
};

export type AppServerNotifyParams = {
	method: string;
	params?: unknown;
};

export type AppServerRespondParams = {
	id: JsonRpcId;
	result: unknown;
};

export type AppServerRespondErrorParams = {
	id: JsonRpcId;
	code: number;
	message: string;
	data?: unknown;
};

export type AppServerNotificationParams = {
	message: JsonRpcNotification;
};

export type AppServerRequestParams = {
	message: JsonRpcRequest;
};

export type GatewayEvent =
	| {
			type: "connected";
			at: string;
	  }
	| {
			type: "appServer.connected";
			at: string;
	  }
	| {
			type: "appServer.closed";
			at: string;
			code?: number | null;
			reason?: string | null;
	  }
	| {
			type: "appServer.error";
			at: string;
			message: string;
	  }
	| {
			type: "unsupportedGatewayCommand";
			at: string;
			method: string;
	  };

export type GatewayEventParams = {
	event: GatewayEvent;
};

export const gatewayOwnedMethodPrefixes = [
	"gateway.delegation.",
	"gateway.workbench.",
	"gateway.flow.",
] as const;

export function isGatewayOwnedMethod(method: string): boolean {
	return gatewayOwnedMethodPrefixes.some((prefix) => method.startsWith(prefix));
}

export function appServerCallParams(
	value: unknown,
): AppServerCallParams | undefined {
	const input = record(value);
	const method = stringValue(input.method);
	if (!method) {
		return undefined;
	}
	return { method, params: input.params };
}

export function appServerNotifyParams(
	value: unknown,
): AppServerNotifyParams | undefined {
	const input = record(value);
	const method = stringValue(input.method);
	if (!method) {
		return undefined;
	}
	return { method, params: input.params };
}

export function appServerRespondParams(
	value: unknown,
): AppServerRespondParams | undefined {
	const input = record(value);
	const id = jsonRpcIdValue(input.id);
	if (id === undefined || !("result" in input)) {
		return undefined;
	}
	return { id, result: input.result };
}

export function appServerRespondErrorParams(
	value: unknown,
): AppServerRespondErrorParams | undefined {
	const input = record(value);
	const id = jsonRpcIdValue(input.id);
	const code = typeof input.code === "number" ? input.code : undefined;
	const message = stringValue(input.message);
	if (id === undefined || code === undefined || !message) {
		return undefined;
	}
	return { id, code, message, data: input.data };
}

export function appServerNotificationParams(
	value: unknown,
): AppServerNotificationParams | undefined {
	const input = record(value);
	const message = jsonRpcNotification(input.message);
	return message ? { message } : undefined;
}

export function appServerRequestParams(
	value: unknown,
): AppServerRequestParams | undefined {
	const input = record(value);
	const message = jsonRpcRequest(input.message);
	return message ? { message } : undefined;
}

export function gatewayEventParams(
	value: unknown,
): GatewayEventParams | undefined {
	const input = record(value);
	const event = record(input.event);
	const type = stringValue(event.type);
	if (!type) {
		return undefined;
	}
	return { event: event as unknown as GatewayEvent };
}

function jsonRpcNotification(value: unknown): JsonRpcNotification | undefined {
	const input = record(value);
	const method = stringValue(input.method);
	if (!method || "id" in input) {
		return undefined;
	}
	return { jsonrpc: "2.0", method, params: input.params };
}

function jsonRpcRequest(value: unknown): JsonRpcRequest | undefined {
	const input = record(value);
	const method = stringValue(input.method);
	const id = jsonRpcIdValue(input.id);
	if (!method || id === undefined) {
		return undefined;
	}
	return { jsonrpc: "2.0", id, method, params: input.params };
}

function jsonRpcIdValue(value: unknown): JsonRpcId | undefined {
	return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
