export type DiscordBridgeLogLevel = "debug" | "info" | "warn" | "error";
export type DiscordBridgeLogLevelSetting = DiscordBridgeLogLevel | "silent";

export type DiscordBridgeLogFields = Record<string, unknown>;

export type DiscordBridgeLogger = {
	debug(event: string, fields?: DiscordBridgeLogFields): void;
	info(event: string, fields?: DiscordBridgeLogFields): void;
	warn(event: string, fields?: DiscordBridgeLogFields): void;
	error(event: string, fields?: DiscordBridgeLogFields): void;
};

export type DiscordBridgeLoggerOptions = {
	component?: string;
	debug?: boolean;
	logLevel?: DiscordBridgeLogLevelSetting;
	now?: () => Date;
	stream?: Pick<NodeJS.WriteStream, "write">;
};

const logLevelRanks: Record<DiscordBridgeLogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

export function createDiscordBridgeLogger(
	options: DiscordBridgeLoggerOptions = {},
): DiscordBridgeLogger {
	const component = options.component ?? "codex-discord-bridge";
	const now = options.now ?? (() => new Date());
	const stream = options.stream ?? process.stderr;
	const logLevel = options.logLevel ?? (options.debug ? "debug" : "info");

	const write = (
		level: DiscordBridgeLogLevel,
		event: string,
		fields: DiscordBridgeLogFields = {},
	): void => {
		if (!shouldWrite(level, logLevel)) {
			return;
		}
		stream.write(
			`${JSON.stringify({
				time: now().toISOString(),
				component,
				level,
				event,
				...fields,
			})}\n`,
		);
	};

	return {
		debug: (event, fields) => write("debug", event, fields),
		info: (event, fields) => write("info", event, fields),
		warn: (event, fields) => write("warn", event, fields),
		error: (event, fields) => write("error", event, fields),
	};
}

function shouldWrite(
	level: DiscordBridgeLogLevel,
	configured: DiscordBridgeLogLevelSetting,
): boolean {
	if (configured === "silent") {
		return false;
	}
	return logLevelRanks[level] >= logLevelRanks[configured];
}
