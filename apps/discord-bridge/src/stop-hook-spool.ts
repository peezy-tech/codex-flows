import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DiscordGatewayStopHookEvent } from "./types.ts";

export type StopHookSpoolDisposition = "processed" | "ignored" | "failed";

export type PendingStopHookSpoolFile =
	| {
			filePath: string;
			fileName: string;
			event: DiscordGatewayStopHookEvent;
	  }
	| {
			filePath: string;
			fileName: string;
			error: Error;
	  };

export function defaultStopHookSpoolDir(): string {
	return path.join(os.homedir(), ".codex", "discord-bridge", "stop-hooks");
}

export function stopHookSpoolDirFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return env.CODEX_DISCORD_HOOK_SPOOL_DIR || defaultStopHookSpoolDir();
}

export function stopHookSpoolPaths(spoolDir: string): Record<
	"pending" | StopHookSpoolDisposition,
	string
> {
	const root = path.resolve(spoolDir);
	return {
		pending: path.join(root, "pending"),
		processed: path.join(root, "processed"),
		ignored: path.join(root, "ignored"),
		failed: path.join(root, "failed"),
	};
}

export async function ensureStopHookSpool(spoolDir: string): Promise<void> {
	const paths = stopHookSpoolPaths(spoolDir);
	await Promise.all(Object.values(paths).map((dir) => mkdir(dir, { recursive: true })));
}

export async function writeStopHookSpoolEvent(
	input: unknown,
	options: {
		spoolDir?: string;
		now?: () => Date;
	} = {},
): Promise<DiscordGatewayStopHookEvent> {
	const spoolDir = options.spoolDir ?? stopHookSpoolDirFromEnv();
	const event = stopHookEventFromInput(input, options.now ?? (() => new Date()));
	const paths = stopHookSpoolPaths(spoolDir);
	await mkdir(paths.pending, { recursive: true });
	const fileName = `${event.id}.json`;
	const finalPath = path.join(paths.pending, fileName);
	const tempPath = path.join(
		paths.pending,
		`.${fileName}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
	);
	await writeFile(tempPath, `${JSON.stringify(event, null, 2)}\n`);
	await rename(tempPath, finalPath);
	return event;
}

export async function readPendingStopHookSpoolFiles(
	spoolDir: string,
): Promise<PendingStopHookSpoolFile[]> {
	const paths = stopHookSpoolPaths(spoolDir);
	await ensureStopHookSpool(spoolDir);
	const fileNames = (await readdir(paths.pending))
		.filter((fileName) => fileName.endsWith(".json"))
		.sort();
	const files: PendingStopHookSpoolFile[] = [];
	for (const fileName of fileNames) {
		const filePath = path.join(paths.pending, fileName);
		try {
			const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
			files.push({
				filePath,
				fileName,
				event: parseStopHookSpoolEvent(parsed),
			});
		} catch (error) {
			files.push({
				filePath,
				fileName,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}
	return files;
}

export async function archiveStopHookSpoolFile(
	file: Pick<PendingStopHookSpoolFile, "filePath" | "fileName">,
	spoolDir: string,
	disposition: StopHookSpoolDisposition,
): Promise<void> {
	const paths = stopHookSpoolPaths(spoolDir);
	await mkdir(paths[disposition], { recursive: true });
	const target = path.join(
		paths[disposition],
		`${Date.now()}-${randomUUID()}-${file.fileName}`,
	);
	try {
		await rename(file.filePath, target);
	} catch (error) {
		const code = error instanceof Error && "code" in error
			? String((error as NodeJS.ErrnoException).code)
			: "";
		if (code === "ENOENT") {
			return;
		}
		throw error;
	}
}

export async function removeStopHookSpool(spoolDir: string): Promise<void> {
	await rm(path.resolve(spoolDir), { recursive: true, force: true });
}

function stopHookEventFromInput(
	input: unknown,
	now: () => Date,
): DiscordGatewayStopHookEvent {
	const parsed = record(input);
	const eventName = stringValue(parsed.hook_event_name) ?? stringValue(parsed.eventName);
	if (eventName && eventName !== "Stop") {
		throw new Error(`Unsupported hook event: ${eventName}`);
	}
	const sessionId = stringValue(parsed.session_id) ?? stringValue(parsed.sessionId);
	if (!sessionId) {
		throw new Error("Stop hook input is missing session_id");
	}
	const turnId = stringValue(parsed.turn_id) ?? stringValue(parsed.turnId);
	const transcriptPath =
		stringValue(parsed.transcript_path) ?? stringValue(parsed.transcriptPath);
	const cwd = stringValue(parsed.cwd);
	const lastAssistantMessage =
		nullableString(parsed.last_assistant_message) ??
		nullableString(parsed.lastAssistantMessage);
	const stopHookActive =
		typeof parsed.stop_hook_active === "boolean"
			? parsed.stop_hook_active
			: typeof parsed.stopHookActive === "boolean"
			? parsed.stopHookActive
			: undefined;
	const id = stopHookEventId({
		sessionId,
		turnId,
		transcriptPath,
		cwd,
	});
	return {
		version: 1,
		id,
		eventName: "Stop",
		sessionId,
		turnId,
		cwd,
		transcriptPath,
		lastAssistantMessage,
		stopHookActive,
		createdAt: now().toISOString(),
	};
}

function parseStopHookSpoolEvent(input: unknown): DiscordGatewayStopHookEvent {
	const parsed = record(input);
	if (parsed.version !== 1) {
		throw new Error("Invalid stop hook event version");
	}
	const eventName = stringValue(parsed.eventName);
	const id = stringValue(parsed.id);
	const sessionId = stringValue(parsed.sessionId);
	const createdAt = stringValue(parsed.createdAt);
	if (eventName !== "Stop" || !id || !sessionId || !createdAt) {
		throw new Error("Invalid stop hook event");
	}
	return {
		version: 1,
		id,
		eventName,
		sessionId,
		turnId: stringValue(parsed.turnId),
		cwd: stringValue(parsed.cwd),
		transcriptPath: stringValue(parsed.transcriptPath),
		lastAssistantMessage: nullableString(parsed.lastAssistantMessage),
		stopHookActive: typeof parsed.stopHookActive === "boolean"
			? parsed.stopHookActive
			: undefined,
		createdAt,
	};
}

function stopHookEventId(input: {
	sessionId: string;
	turnId?: string;
	transcriptPath?: string;
	cwd?: string;
}): string {
	const identity = input.turnId
		? { eventName: "Stop", sessionId: input.sessionId, turnId: input.turnId }
		: {
				eventName: "Stop",
				sessionId: input.sessionId,
				transcriptPath: input.transcriptPath,
				cwd: input.cwd,
			};
	return `stop-${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24)}`;
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nullableString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
