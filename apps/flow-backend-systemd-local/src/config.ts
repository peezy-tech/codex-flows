import path from "node:path";

export type FlowBackendExecutor = "direct" | "systemd-run";

export type FlowBackendConfig = {
	cwd: string;
	dataDir: string;
	host: string;
	port: number;
	secret?: string;
	executor: FlowBackendExecutor;
	bunCommand: string;
	flowRunnerPath: string;
	forwardEnv: string[];
};

export type FlowBackendCli =
	| { kind: "help" }
	| { kind: "serve"; config: FlowBackendConfig }
	| { kind: "dispatch"; config: FlowBackendConfig; eventPath: string; wait: boolean };

export function readConfig(
	env: Record<string, string | undefined> = process.env,
	overrides: Partial<FlowBackendConfig> = {},
): FlowBackendConfig {
	const cwd = path.resolve(overrides.cwd ?? env.CODEX_FLOW_BACKEND_CWD ?? process.cwd());
	const dataDir = path.resolve(overrides.dataDir ?? env.CODEX_FLOW_BACKEND_DATA_DIR ?? path.join(cwd, ".codex", "flow-backend"));
	return {
		cwd,
		dataDir,
		host: overrides.host ?? env.CODEX_FLOW_BACKEND_HOST ?? "127.0.0.1",
		port: overrides.port ?? numberEnv(env.CODEX_FLOW_BACKEND_PORT, 7345),
		...(overrides.secret ?? env.CODEX_FLOW_BACKEND_SECRET
			? { secret: overrides.secret ?? env.CODEX_FLOW_BACKEND_SECRET }
			: {}),
		executor: overrides.executor ?? executorEnv(env.CODEX_FLOW_BACKEND_EXECUTOR),
		bunCommand: overrides.bunCommand ?? env.CODEX_FLOW_BACKEND_BUN ?? process.execPath,
		flowRunnerPath: path.resolve(
			overrides.flowRunnerPath ?? env.CODEX_FLOW_RUNNER_PATH ?? defaultFlowRunnerPath(),
		),
		forwardEnv: overrides.forwardEnv ?? forwardEnv(env.CODEX_FLOW_BACKEND_FORWARD_ENV),
	};
}

export function parseCli(argv: string[], env: Record<string, string | undefined> = process.env): FlowBackendCli {
	const command = argv[0];
	if (!command || command === "help" || command === "-h" || command === "--help") {
		return { kind: "help" };
	}

	let cwd: string | undefined;
	let dataDir: string | undefined;
	let host: string | undefined;
	let port: number | undefined;
	let secret: string | undefined;
	let executor: FlowBackendExecutor | undefined;
	let bunCommand: string | undefined;
	let flowRunnerPath: string | undefined;
	let wait = false;
	let eventPath: string | undefined;
	const rest = argv.slice(1);
	for (let index = 0; index < rest.length; index += 1) {
		const arg = rest[index];
		if (!arg) {
			continue;
		}
		if (arg === "--cwd") {
			cwd = required(rest, ++index, arg);
			continue;
		}
		if (arg === "--data-dir") {
			dataDir = required(rest, ++index, arg);
			continue;
		}
		if (arg === "--host") {
			host = required(rest, ++index, arg);
			continue;
		}
		if (arg === "--port") {
			port = Number(required(rest, ++index, arg));
			continue;
		}
		if (arg === "--secret") {
			secret = required(rest, ++index, arg);
			continue;
		}
		if (arg === "--executor") {
			executor = executorEnv(required(rest, ++index, arg));
			continue;
		}
		if (arg === "--bun") {
			bunCommand = required(rest, ++index, arg);
			continue;
		}
		if (arg === "--flow-runner") {
			flowRunnerPath = required(rest, ++index, arg);
			continue;
		}
		if (arg === "--event") {
			eventPath = required(rest, ++index, arg);
			continue;
		}
		if (arg === "--wait") {
			wait = true;
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}

	const config = readConfig(env, {
		...(cwd ? { cwd } : {}),
		...(dataDir ? { dataDir } : {}),
		...(host ? { host } : {}),
		...(port !== undefined ? { port } : {}),
		...(secret ? { secret } : {}),
		...(executor ? { executor } : {}),
		...(bunCommand ? { bunCommand } : {}),
		...(flowRunnerPath ? { flowRunnerPath } : {}),
	});
	if (command === "serve") {
		return { kind: "serve", config };
	}
	if (command === "dispatch") {
		if (!eventPath) {
			throw new Error("dispatch requires --event <path>");
		}
		return { kind: "dispatch", config, eventPath, wait };
	}
	throw new Error(`Unknown command: ${command}`);
}

export function defaultFlowRunnerPath(): string {
	return path.resolve(import.meta.dir, "..", "..", "flow-runner", "src", "index.ts");
}

export function helpText(): string {
	return [
		"Usage:",
		"  codex-flow-systemd-local serve [--cwd <dir>] [--data-dir <dir>] [--host <host>] [--port <port>]",
		"  codex-flow-systemd-local dispatch --event <event.json> [--cwd <dir>] [--data-dir <dir>] [--wait]",
		"",
		"Environment:",
		"  CODEX_FLOW_BACKEND_SECRET       Optional HMAC secret for HTTP dispatches",
		"  CODEX_FLOW_BACKEND_EXECUTOR     direct or systemd-run",
		"  CODEX_FLOWS_MODE                Set to code-mode to enable Code Mode and fork defaults",
		"  CODEX_FLOWS_ENABLE_CODE_MODE    Enables runner = \"code-mode\" steps",
		"  CODEX_FLOW_PUSH/PUBLISH         Optional release-flow action gates",
		"",
	].join("\n");
}

function numberEnv(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function executorEnv(value: string | undefined): FlowBackendExecutor {
	if (value === "systemd-run") {
		return "systemd-run";
	}
	if (!value || value === "direct") {
		return "direct";
	}
	throw new Error("executor must be direct or systemd-run");
}

function forwardEnv(value: string | undefined): string[] {
	const defaults = [
		"CODEX_FLOWS_MODE",
		"CODEX_FLOWS_ENABLE_CODE_MODE",
		"CODEX_FLOW_COMMIT",
		"CODEX_FLOW_PUSH",
		"CODEX_FLOW_PUBLISH",
		"CODEX_FLOW_FORCE",
		"CODEX_FLOW_SQUASH_PATCH_STACK",
		"CODEX_APP_SERVER_CODEX_COMMAND",
		"CODEX_APP_SERVER_CODEX_PACKAGE",
		"CODEX_APP_SERVER_BUNX_COMMAND",
		"CODEX_HOME",
		"PEEZY_CODEX_REPO",
		"PEEZY_CODEX_TARGET_BRANCH",
		"PEEZY_CODEX_CARGO_TARGET_DIR",
		"HOME",
		"PATH",
	];
	if (!value) {
		return defaults;
	}
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function required(args: string[], index: number, flag: string): string {
	const value = args[index];
	if (!value) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}
