import { validateMethodName } from "./actions.ts";
import { parseMode, type WorkspaceModeInput } from "./workspace-autonomy.ts";
import type { MemoryTransplantDirection } from "./memories.ts";

export type ParsedCli =
	| { type: "help" }
	| {
			type: "fetch";
			appUrl: string;
			workspaceUrl: string;
			timeoutMs: number;
			color: boolean;
			json: boolean;
	  }
	| { type: "app-actions" }
	| {
			type: "app-call";
			method: string;
			paramsText?: string;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| { type: "workspace-methods"; url: string; timeoutMs: number; pretty: boolean }
	| {
			type: "workspace-doctor";
			mode?: WorkspaceModeInput;
			workspaceRoot?: string;
			appUrl: string;
			workspaceUrl: string;
			timeoutMs: number;
			color: boolean;
			json: boolean;
	  }
	| {
			type: "workspace-tick";
			mode?: WorkspaceModeInput;
			workspaceRoot?: string;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "workspace-run";
			taskId: string;
			mode?: WorkspaceModeInput;
			workspaceRoot?: string;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "workspace-call";
			method: string;
			paramsText?: string;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "workspace-app-call";
			method: string;
			paramsText?: string;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "flow-dispatch";
			eventPath: string;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "flow-list-events";
			eventType?: string;
			limit?: number;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "flow-get-event";
			eventId: string;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "flow-replay";
			eventId: string;
			wait: boolean;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "flow-list-runs";
			eventId?: string;
			status?: string;
			limit?: number;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "flow-get-run";
			runId: string;
			url: string;
			timeoutMs: number;
			pretty: boolean;
	  }
	| {
			type: "memories-transplant";
			direction: MemoryTransplantDirection;
			workspaceRoot?: string;
			globalCodexHome?: string;
			workspaceCodexHome?: string;
			apply: boolean;
			overwrite: boolean;
			merge?: "codex";
			backup: boolean;
			json: boolean;
	  };

export const DEFAULT_APP_SERVER_WS_URL = "ws://127.0.0.1:3585";
export const DEFAULT_WORKSPACE_BACKEND_WS_URL = "ws://127.0.0.1:3586";
const defaultTimeoutMs = 90_000;

export function parseArgs(
	argv: string[],
	env: Record<string, string | undefined> = process.env,
): ParsedCli {
	const positionals: string[] = [];
	let appUrl = env.CODEX_WORKSPACE_APP_SERVER_WS_URL ?? DEFAULT_APP_SERVER_WS_URL;
	let workspaceUrl = env.CODEX_WORKSPACE_BACKEND_WS_URL ??
		DEFAULT_WORKSPACE_BACKEND_WS_URL;
	let timeoutMs = defaultTimeoutMs;
	let pretty = true;
	let color = true;
	let json = false;
	let eventPath: string | undefined;
	let eventType: string | undefined;
	let eventId: string | undefined;
	let runId: string | undefined;
	let status: string | undefined;
	let limit: number | undefined;
	let wait = false;
	let mode: WorkspaceModeInput | undefined;
	let workspaceRoot: string | undefined;
	let globalCodexHome: string | undefined;
	let workspaceCodexHome: string | undefined;
	let apply = false;
	let overwrite = false;
	let merge: "codex" | undefined;
	let backup = true;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg) {
			continue;
		}
		if (arg === "-h" || arg === "--help") {
			return { type: "help" };
		}
		if (arg === "--url" || arg === "--ws-url") {
			const value = required(argv, ++index, arg);
			appUrl = value;
			workspaceUrl = value;
			continue;
		}
		if (arg.startsWith("--url=")) {
			const value = arg.slice("--url=".length);
			appUrl = value;
			workspaceUrl = value;
			continue;
		}
		if (arg.startsWith("--ws-url=")) {
			const value = arg.slice("--ws-url=".length);
			appUrl = value;
			workspaceUrl = value;
			continue;
		}
		if (arg === "--app-url" || arg === "--app-server-url") {
			appUrl = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--app-url=")) {
			appUrl = arg.slice("--app-url=".length);
			continue;
		}
		if (arg.startsWith("--app-server-url=")) {
			appUrl = arg.slice("--app-server-url=".length);
			continue;
		}
		if (arg === "--workspace-url" || arg === "--workspace-backend-url") {
			workspaceUrl = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--workspace-url=")) {
			workspaceUrl = arg.slice("--workspace-url=".length);
			continue;
		}
		if (arg.startsWith("--workspace-backend-url=")) {
			workspaceUrl = arg.slice("--workspace-backend-url=".length);
			continue;
		}
		if (arg === "--timeout-ms") {
			timeoutMs = positiveInteger(required(argv, ++index, arg), arg);
			continue;
		}
		if (arg.startsWith("--timeout-ms=")) {
			timeoutMs = positiveInteger(arg.slice("--timeout-ms=".length), "--timeout-ms");
			continue;
		}
		if (arg === "--compact") {
			pretty = false;
			continue;
		}
		if (arg === "--pretty") {
			pretty = true;
			continue;
		}
		if (arg === "--no-color") {
			color = false;
			continue;
		}
		if (arg === "--color") {
			color = true;
			continue;
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--mode") {
			mode = parseMode(required(argv, ++index, arg));
			continue;
		}
		if (arg.startsWith("--mode=")) {
			mode = parseMode(arg.slice("--mode=".length));
			continue;
		}
		if (arg === "--workspace-root") {
			workspaceRoot = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--workspace-root=")) {
			workspaceRoot = arg.slice("--workspace-root=".length);
			continue;
		}
		if (arg === "--global-codex-home") {
			globalCodexHome = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--global-codex-home=")) {
			globalCodexHome = arg.slice("--global-codex-home=".length);
			continue;
		}
		if (arg === "--workspace-codex-home") {
			workspaceCodexHome = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--workspace-codex-home=")) {
			workspaceCodexHome = arg.slice("--workspace-codex-home=".length);
			continue;
		}
		if (arg === "--apply") {
			apply = true;
			continue;
		}
		if (arg === "--overwrite") {
			overwrite = true;
			continue;
		}
		if (arg === "--merge") {
			const value = required(argv, ++index, arg);
			if (value !== "codex") {
				throw new Error("--merge currently supports only codex");
			}
			merge = "codex";
			continue;
		}
		if (arg.startsWith("--merge=")) {
			const value = arg.slice("--merge=".length);
			if (value !== "codex") {
				throw new Error("--merge currently supports only codex");
			}
			merge = "codex";
			continue;
		}
		if (arg === "--backup") {
			backup = true;
			continue;
		}
		if (arg === "--no-backup") {
			backup = false;
			continue;
		}
		if (arg === "--event") {
			eventPath = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--event=")) {
			eventPath = arg.slice("--event=".length);
			continue;
		}
		if (arg === "--event-id") {
			eventId = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--event-id=")) {
			eventId = arg.slice("--event-id=".length);
			continue;
		}
		if (arg === "--run-id") {
			runId = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--run-id=")) {
			runId = arg.slice("--run-id=".length);
			continue;
		}
		if (arg === "--type") {
			eventType = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--type=")) {
			eventType = arg.slice("--type=".length);
			continue;
		}
		if (arg === "--status") {
			status = required(argv, ++index, arg);
			continue;
		}
		if (arg.startsWith("--status=")) {
			status = arg.slice("--status=".length);
			continue;
		}
		if (arg === "--limit") {
			limit = positiveInteger(required(argv, ++index, arg), arg);
			continue;
		}
		if (arg.startsWith("--limit=")) {
			limit = positiveInteger(arg.slice("--limit=".length), "--limit");
			continue;
		}
		if (arg === "--wait") {
			wait = true;
			continue;
		}
		if (arg === "--") {
			positionals.push(...argv.slice(index + 1));
			break;
		}
		if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		}
		positionals.push(arg);
	}

	const command = positionals[0];
	if (!command || command === "help") {
		return { type: "help" };
	}
	if (command === "fetch" || command === "neofetch") {
		return {
			type: "fetch",
			appUrl,
			workspaceUrl,
			timeoutMs: timeoutMs === defaultTimeoutMs ? 1_500 : timeoutMs,
			color,
			json,
		};
	}
	if (command === "app") {
		const subcommand = positionals[1];
		if (!subcommand || subcommand === "actions") {
			return { type: "app-actions" };
		}
		const method = subcommand === "call"
			? requiredPositional(positionals, 2, "app call requires <method>")
			: subcommand;
		const params = subcommand === "call" ? positionals.slice(3) : positionals.slice(2);
		return {
			type: "app-call",
			method: validateMethodName(method, "app method"),
			paramsText: paramsText(params),
			url: appUrl,
			timeoutMs,
			pretty,
		};
	}
	if (command === "workspace") {
		const subcommand = positionals[1];
		if (!subcommand || subcommand === "methods") {
			return { type: "workspace-methods", url: workspaceUrl, timeoutMs, pretty };
		}
		if (subcommand === "doctor") {
			return {
				type: "workspace-doctor",
				mode,
				workspaceRoot,
				appUrl,
				workspaceUrl,
				timeoutMs: timeoutMs === defaultTimeoutMs ? 1_500 : timeoutMs,
				color,
				json,
			};
		}
		if (subcommand === "tick") {
			return {
				type: "workspace-tick",
				mode,
				workspaceRoot,
				url: workspaceUrl,
				timeoutMs,
				pretty,
			};
		}
		if (subcommand === "run") {
			return {
				type: "workspace-run",
				taskId: requiredPositional(positionals, 2, "workspace run requires <task-id>"),
				mode,
				workspaceRoot,
				url: workspaceUrl,
				timeoutMs,
				pretty,
			};
		}
		if (subcommand === "app") {
			const method = requiredPositional(
				positionals,
				2,
				"workspace app requires <method>",
			);
			return {
				type: "workspace-app-call",
				method: validateMethodName(method, "app method"),
				paramsText: paramsText(positionals.slice(3)),
				url: workspaceUrl,
				timeoutMs,
				pretty,
			};
		}
		const method = subcommand === "call"
			? requiredPositional(positionals, 2, "workspace call requires <method>")
			: subcommand;
		const params = subcommand === "call" ? positionals.slice(3) : positionals.slice(2);
		return {
			type: "workspace-call",
			method: validateMethodName(method, "workspace method"),
			paramsText: paramsText(params),
			url: workspaceUrl,
			timeoutMs,
			pretty,
		};
	}
	if (command === "flow") {
		const subcommand = positionals[1];
		if (subcommand === "dispatch") {
			return {
				type: "flow-dispatch",
				eventPath: eventPath ?? requiredPositional(
					positionals,
					2,
					"flow dispatch requires --event <path> or <path>",
				),
				url: workspaceUrl,
				timeoutMs,
				pretty,
			};
		}
		if (subcommand === "events" || subcommand === "list-events") {
			return {
				type: "flow-list-events",
				eventType,
				limit,
				url: workspaceUrl,
				timeoutMs,
				pretty,
			};
		}
		if (subcommand === "event" || subcommand === "show-event") {
			return {
				type: "flow-get-event",
				eventId: eventId ?? requiredPositional(
					positionals,
					2,
					"flow event requires <event-id>",
				),
				url: workspaceUrl,
				timeoutMs,
				pretty,
			};
		}
		if (subcommand === "replay" || subcommand === "replay-event") {
			return {
				type: "flow-replay",
				eventId: eventId ?? requiredPositional(
					positionals,
					2,
					"flow replay requires <event-id>",
				),
				wait,
				url: workspaceUrl,
				timeoutMs,
				pretty,
			};
		}
		if (subcommand === "runs" || subcommand === "list-runs") {
			return {
				type: "flow-list-runs",
				eventId,
				status,
				limit,
				url: workspaceUrl,
				timeoutMs,
				pretty,
			};
		}
		if (subcommand === "run" || subcommand === "show-run") {
			return {
				type: "flow-get-run",
				runId: runId ?? requiredPositional(
					positionals,
					2,
					"flow run requires <run-id>",
				),
				url: workspaceUrl,
				timeoutMs,
				pretty,
			};
		}
		throw new Error("flow requires dispatch, events, event, replay, runs, or run");
	}
	if (command === "memories") {
		const subcommand = positionals[1];
		if (subcommand !== "transplant") {
			throw new Error("memories requires transplant");
		}
		const direction = requiredPositional(positionals, 2, "memories transplant requires a direction");
		if (direction !== "global-to-workspace" && direction !== "workspace-to-global") {
			throw new Error(`Invalid memories transplant direction: ${direction}`);
		}
		return {
			type: "memories-transplant",
			direction,
			workspaceRoot,
			globalCodexHome,
			workspaceCodexHome,
			apply,
			overwrite,
			merge,
			backup,
			json,
		};
	}
	throw new Error(`Unknown command: ${command}`);
}

function paramsText(values: string[]): string | undefined {
	return values.length > 0 ? values.join(" ") : undefined;
}

function required(args: string[], index: number, flag: string): string {
	const value = args[index];
	if (!value) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function requiredPositional(args: string[], index: number, message: string): string {
	const value = args[index];
	if (!value) {
		throw new Error(message);
	}
	return value;
}

function positiveInteger(value: string, flag: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive integer`);
	}
	return parsed;
}
