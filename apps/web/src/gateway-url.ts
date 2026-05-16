export const gatewayStorageKey = "codex-bare.gateway-url";

export type GatewayUrlOptions = {
	envUrl?: string;
	location: Pick<Location, "host" | "protocol">;
	storage?: Pick<Storage, "getItem">;
};

export function initialGatewayWsUrl(options: GatewayUrlOptions): string {
	return options.storage?.getItem(gatewayStorageKey) ??
		options.envUrl ??
		proxiedGatewayWsUrl(options.location);
}

export function proxiedGatewayWsUrl(
	location: Pick<Location, "host" | "protocol">,
): string {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${location.host}/__codex-gateway`;
}
