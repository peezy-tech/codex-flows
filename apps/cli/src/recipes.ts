import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CodexAppServerClient } from "@peezy.tech/codex-flows";

type StopHookInput = {
	session_id?: unknown;
	transcript_path?: unknown;
	cwd?: unknown;
	hook_event_name?: unknown;
	turn_id?: unknown;
	last_assistant_message?: unknown;
};

type ToolInputHookInput = StopHookInput & {
	tool_name?: unknown;
	tool_input?: unknown;
	tool_use_id?: unknown;
};

export type ExtractCodeModeOptions = {
	stdin: NodeJS.ReadableStream;
	outputDir?: string;
	now?: Date;
};

export type RunCodeModeOptions = {
	file: string;
	cwd?: string;
	codexCommand?: string;
	url: string;
	timeoutMs: number;
};

export type ExtractCodeModeResult = {
	continue: true;
	saved: Array<{ codePath: string; metadataPath: string }>;
};

type CommandExecResponse = Awaited<ReturnType<CodexAppServerClient["commandExec"]>>;

type ReplayExecCommandInput = {
	cmd?: unknown;
	workdir?: unknown;
	cwd?: unknown;
	shell?: unknown;
	timeout_ms?: unknown;
	max_output_tokens?: unknown;
};

export async function extractCodeModeCandidates(
	options: ExtractCodeModeOptions,
): Promise<ExtractCodeModeResult> {
	const rawInput = await readStream(options.stdin);
	const input = parseHookInput(rawInput);
	const workspaceCwd = stringValue(input.cwd) ?? process.cwd();
	const outputDir = path.resolve(
		workspaceCwd,
		options.outputDir ?? ".codex/code-mode-candidates",
	);
	const rawSources = await readCandidateSources(input);
	const candidates = uniqueCodeBlocks(rawSources.flatMap(extractJavaScriptBlocks));
	const saved: ExtractCodeModeResult["saved"] = [];

	await mkdir(outputDir, { recursive: true });
	for (const code of candidates) {
		const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
		const stem = `${slug(stringValue(input.turn_id) ?? timestamp(options.now))}-${hash}`;
		const codePath = path.join(outputDir, `${stem}.mjs`);
		const metadataPath = path.join(outputDir, `${stem}.json`);
		await writeFile(codePath, `${code.trim()}\n`);
		await writeFile(
			metadataPath,
			`${JSON.stringify(
				{
					version: 1,
					sessionId: stringValue(input.session_id),
					turnId: stringValue(input.turn_id),
					transcriptPath: stringValue(input.transcript_path),
					cwd: workspaceCwd,
					codePath,
					createdAt: (options.now ?? new Date()).toISOString(),
					source: "codex-stop-hook",
					status: "candidate",
				},
				null,
				2,
			)}\n`,
		);
		saved.push({ codePath, metadataPath });
	}

	return { continue: true, saved };
}

export async function extractCodeModeToolInputCandidates(
	options: ExtractCodeModeOptions,
): Promise<ExtractCodeModeResult> {
	const rawInput = await readStream(options.stdin);
	const input = parseHookInput(rawInput);
	const workspaceCwd = stringValue(input.cwd) ?? process.cwd();
	const outputDir = path.resolve(
		workspaceCwd,
		options.outputDir ?? ".codex/code-mode-candidates",
	);
	const code = toolInputSource(input);
	const saved: ExtractCodeModeResult["saved"] = [];

	if (!code) {
		return { continue: true, saved };
	}

	await mkdir(outputDir, { recursive: true });
	const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
	const stem = `${slug(
		stringValue(input.turn_id) ?? stringValue(input.tool_use_id) ?? timestamp(options.now),
	)}-${hash}`;
	const codePath = path.join(outputDir, `${stem}.mjs`);
	const metadataPath = path.join(outputDir, `${stem}.json`);
	await writeFile(codePath, `${code.trim()}\n`);
	await writeFile(
		metadataPath,
		`${JSON.stringify(
			{
				version: 1,
				sessionId: stringValue(input.session_id),
				turnId: stringValue(input.turn_id),
				toolUseId: stringValue(input.tool_use_id),
				transcriptPath: stringValue(input.transcript_path),
				cwd: workspaceCwd,
				codePath,
				createdAt: (options.now ?? new Date()).toISOString(),
				source: "codex-pre-tool-use-exec",
				status: "candidate",
			},
			null,
			2,
		)}\n`,
	);
	saved.push({ codePath, metadataPath });

	return { continue: true, saved };
}

export async function runCodeModeCandidate(options: RunCodeModeOptions) {
	const file = path.resolve(options.file);
	const source = await readFile(file, "utf8");
	const metadata = await readCandidateMetadata(file);
	const cwd = path.resolve(options.cwd ?? metadata.cwd ?? process.cwd());
	const output: string[] = [];
	const storedValues = new Map<string, unknown>();
	const client = new CodexAppServerClient({
		...(options.url === "stdio://"
			? {
					transportOptions: {
						codexCommand: options.codexCommand,
						requestTimeoutMs: options.timeoutMs,
					},
				}
			: {
					webSocketTransportOptions: {
						url: options.url,
						requestTimeoutMs: options.timeoutMs,
					},
				}),
		clientName: "codex-app-cli",
		clientTitle: "Codex App CLI",
		clientVersion: "0.1.0",
	});

	client.on("request", (message) => {
		client.respondError(message.id, -32603, "codex-app CLI does not handle server requests");
	});

	try {
		await client.connect();
		await evaluateCodeModeSource(source, {
			client,
			cwd,
			output,
			storedValues,
			timeoutMs: options.timeoutMs,
		});
		return {
			exitCode: 0,
			stdout: output.join(""),
			stderr: "",
		} satisfies CommandExecResponse;
	} catch (error) {
		return {
			exitCode: 1,
			stdout: output.join(""),
			stderr: errorText(error),
		} satisfies CommandExecResponse;
	} finally {
		client.close();
	}
}

async function evaluateCodeModeSource(
	source: string,
	options: {
		client: CodexAppServerClient;
		cwd: string;
		output: string[];
		storedValues: Map<string, unknown>;
		timeoutMs: number;
	},
) {
	const tools = createReplayTools(options);
	const text = (value: unknown) => {
		options.output.push(outputText(value));
	};
	const image = () => {
		// Image replay is intentionally a no-op until the CLI has a display target.
	};
	const store = (key: string, value: unknown) => {
		options.storedValues.set(key, value);
	};
	const load = (key: string) => options.storedValues.get(key);
	const notify = (value: unknown) => {
		options.output.push(outputText(value));
	};
	const yieldControl = async () => undefined;
	const exit = () => {
		throw new CodeModeExit();
	};
	const AsyncFunction = async function () {
		return undefined;
	}.constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
	const run = new AsyncFunction(
		"tools",
		"text",
		"image",
		"store",
		"load",
		"notify",
		"setTimeout",
		"clearTimeout",
		"ALL_TOOLS",
		"yield_control",
		"exit",
		source,
	);

	try {
		await run(
			tools,
			text,
			image,
			store,
			load,
			notify,
			setTimeout,
			clearTimeout,
			ALL_REPLAY_TOOLS,
			yieldControl,
			exit,
		);
	} catch (error) {
		if (error instanceof CodeModeExit) {
			return;
		}
		throw error;
	}
}

function createReplayTools(options: {
	client: CodexAppServerClient;
	cwd: string;
	timeoutMs: number;
}) {
	return {
		exec_command: async (input: ReplayExecCommandInput) => {
			const command = stringValue(input.cmd);
			if (!command) {
				throw new Error("exec_command requires a string cmd");
			}
			const startedAt = Date.now();
			const shell = stringValue(input.shell) ?? "/bin/bash";
			const response = await options.client.commandExec({
				command: [shell, "-lc", command],
				cwd: stringValue(input.workdir) ?? stringValue(input.cwd) ?? options.cwd,
				timeoutMs: numberValue(input.timeout_ms) ?? options.timeoutMs,
				disableOutputCap: true,
				sandboxPolicy: { type: "dangerFullAccess" },
			});
			const output = response.stdout + response.stderr;
			const maxOutputTokens = numberValue(input.max_output_tokens);
			const truncated = truncateOutput(output, maxOutputTokens);
			return {
				exit_code: response.exitCode,
				output: truncated.output,
				...(truncated.originalTokenCount === undefined
					? {}
					: { original_token_count: truncated.originalTokenCount }),
				wall_time_seconds: (Date.now() - startedAt) / 1000,
			};
		},
	};
}

const ALL_REPLAY_TOOLS = [
	{
		name: "exec_command",
		description: "Runs a shell command through the selected Codex app-server.",
	},
];

class CodeModeExit extends Error {}

async function readCandidateSources(input: StopHookInput) {
	const sources: string[] = [];
	const lastAssistantMessage = stringValue(input.last_assistant_message);
	if (lastAssistantMessage) {
		sources.push(lastAssistantMessage);
	}

	const transcriptPath = stringValue(input.transcript_path);
	if (transcriptPath) {
		try {
			sources.push(await readFile(transcriptPath, "utf8"));
		} catch {
			// Missing transcripts should not block the Stop hook.
		}
	}
	return sources;
}

function extractJavaScriptBlocks(raw: string) {
	const blocks: string[] = [];
	const fenced = /```(?:js|javascript|mjs|ts|typescript)\s*\n([\s\S]*?)```/gi;
	for (let match = fenced.exec(raw); match; match = fenced.exec(raw)) {
		const code = match[1]?.trim();
		if (code) {
			blocks.push(code);
		}
	}
	return blocks;
}

function uniqueCodeBlocks(blocks: string[]) {
	const seen = new Set<string>();
	return blocks.filter((block) => {
		const normalized = block.trim();
		if (!normalized || seen.has(normalized)) {
			return false;
		}
		seen.add(normalized);
		return true;
	});
}

function toolInputSource(input: ToolInputHookInput) {
	if (stringValue(input.tool_name) !== "exec") {
		return undefined;
	}
	const toolInput = recordValue(input.tool_input);
	return toolInput ? stringValue(toolInput.source) : undefined;
}

async function readCandidateMetadata(file: string): Promise<{ cwd?: string }> {
	const metadataPath = file.replace(/\.[^.]+$/, ".json");
	try {
		const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as unknown;
		if (isRecord(parsed) && typeof parsed.cwd === "string") {
			return { cwd: parsed.cwd };
		}
	} catch {
		// Metadata is optional; explicit --cwd or process cwd can still run the file.
	}
	return {};
}

function parseHookInput(rawInput: string): ToolInputHookInput {
	if (!rawInput.trim()) {
		return {};
	}
	try {
		const parsed = JSON.parse(rawInput) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

async function readStream(stream: NodeJS.ReadableStream) {
	let text = "";
	stream.setEncoding("utf8");
	for await (const chunk of stream) {
		text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
	}
	return text;
}

function stringValue(value: unknown) {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function outputText(value: unknown) {
	if (typeof value === "string") {
		return value;
	}
	try {
		const json = JSON.stringify(value);
		return json === undefined ? String(value) : json;
	} catch {
		return String(value);
	}
}

function truncateOutput(output: string, maxOutputTokens: number | undefined) {
	if (!maxOutputTokens || maxOutputTokens <= 0) {
		return { output };
	}
	const maxChars = maxOutputTokens * 4;
	if (output.length <= maxChars) {
		return { output };
	}
	return {
		output: output.slice(0, maxChars),
		originalTokenCount: Math.ceil(output.length / 4),
	};
}

function errorText(error: unknown) {
	if (error instanceof Error) {
		return error.stack ?? error.message;
	}
	return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown) {
	return isRecord(value) ? value : undefined;
}

function timestamp(now: Date | undefined) {
	return (now ?? new Date()).toISOString();
}

function slug(value: string) {
	return value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "turn";
}
