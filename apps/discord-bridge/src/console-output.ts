export type DiscordConsoleMessageKind =
	| "summary"
	| "commentary"
	| "final"
	| "error";

export type DiscordConsoleMessage = {
	kind: DiscordConsoleMessageKind;
	text: string;
	discordThreadId: string;
	codexThreadId: string;
	turnId?: string;
	title?: string;
	at?: Date;
};

export type DiscordConsoleOutput = {
	message(message: DiscordConsoleMessage): void;
};

export type ConsoleMessageOutputOptions = {
	color?: boolean;
	now?: () => Date;
	stream?: Pick<NodeJS.WriteStream, "write">;
};

export type ConsoleMessageFormatOptions = {
	color?: boolean;
	now?: () => Date;
};

const resetColor = "\x1b[0m";
const kindColors: Record<DiscordConsoleMessageKind, string> = {
	summary: "\x1b[90m",
	commentary: "\x1b[36m",
	final: "\x1b[32m",
	error: "\x1b[31m",
};

export function createDiscordConsoleOutput(
	options: ConsoleMessageOutputOptions = {},
): DiscordConsoleOutput {
	const stream = options.stream ?? process.stdout;
	const color = options.color ??
		Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
	const now = options.now ?? (() => new Date());
	return {
		message(message) {
			stream.write(`${formatConsoleMessage(message, { color, now })}\n`);
		},
	};
}

export function formatConsoleMessage(
	message: DiscordConsoleMessage,
	options: ConsoleMessageFormatOptions = {},
): string {
	const now = options.now ?? (() => new Date());
	const time = formatTime(message.at ?? now());
	const kind = message.kind.toUpperCase().padEnd(10);
	const coloredKind = colorize(kind, kindColors[message.kind], options.color ?? false);
	const title = (message.title?.trim() || compactId(message.codexThreadId)).replace(
		/\s+/g,
		" ",
	);
	const metadata = [
		`thread=${compactId(message.codexThreadId)}`,
		message.turnId ? `turn=${compactId(message.turnId)}` : undefined,
	].filter(Boolean).join(" ");
	const header = `[${time}] ${coloredKind} ${title} ${metadata}`;
	const body = formatBody(message.text);
	return body ? `${header}\n${body}` : header;
}

function formatBody(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) {
		return "";
	}
	return trimmed
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}

function formatTime(date: Date): string {
	return date.toISOString().slice(11, 23);
}

function compactId(id: string): string {
	if (id.length <= 12) {
		return id;
	}
	return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function colorize(text: string, color: string, enabled: boolean): string {
	return enabled ? `${color}${text}${resetColor}` : text;
}
