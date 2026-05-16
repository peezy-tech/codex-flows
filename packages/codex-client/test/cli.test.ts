import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli/args.ts";
import { formatFetchInfo, type FetchInfo } from "../src/cli/fetch.ts";

describe("codex-flows CLI args", () => {
	test("parses direct app-server calls", () => {
		expect(parseArgs(["app", "thread/list", "{\"limit\":1}"], {}))
			.toMatchObject({
				type: "app-call",
				method: "thread/list",
				paramsText: "{\"limit\":1}",
				url: "ws://127.0.0.1:3585",
			});
	});

	test("parses workspace-owned method calls", () => {
		expect(parseArgs([
			"--workspace-url",
			"ws://127.0.0.1:4596",
			"workspace",
			"delegation.list",
		], {})).toMatchObject({
			type: "workspace-call",
			method: "delegation.list",
			url: "ws://127.0.0.1:4596",
		});
	});

	test("parses app-server pass-through through the workspace backend", () => {
		expect(parseArgs([
			"workspace",
			"app",
			"thread/list",
			"{\"limit\":2}",
		], {})).toMatchObject({
			type: "workspace-app-call",
			method: "thread/list",
			paramsText: "{\"limit\":2}",
		});
	});

	test("parses flow inspection commands", () => {
		expect(parseArgs(["flow", "events", "--type", "demo.event", "--limit=10"], {}))
			.toMatchObject({
				type: "flow-list-events",
				eventType: "demo.event",
				limit: 10,
			});
		expect(parseArgs(["flow", "run", "run_123"], {})).toMatchObject({
			type: "flow-get-run",
			runId: "run_123",
		});
	});

	test("parses pack commands", () => {
		expect(parseArgs(["pack", "inspect", "owner/repo", "--ref", "main", "--json"], {}))
			.toEqual({
				type: "pack-inspect",
				source: "owner/repo",
				ref: "main",
				json: true,
			});
		expect(parseArgs([
			"--workspace-root",
			"/workspace",
			"pack",
			"add",
			"./pack",
			"--apply",
			"--overwrite",
			"--include",
			"tdd",
			"--exclude=repo-policy",
		], {})).toEqual({
			type: "pack-add",
			source: "./pack",
			ref: undefined,
			workspaceRoot: "/workspace",
			apply: true,
			overwrite: true,
			include: ["tdd"],
			exclude: ["repo-policy"],
			json: false,
		});
		expect(parseArgs(["pack", "doctor", "--json"], {})).toEqual({
			type: "pack-doctor",
			workspaceRoot: undefined,
			json: true,
		});
		expect(parseArgs(["pack", "list"], {})).toEqual({
			type: "pack-list",
			workspaceRoot: undefined,
			json: false,
		});
	});

	test("rejects invalid method names", () => {
		expect(() => parseArgs(["workspace", "not a method"], {}))
			.toThrow("workspace method must be a JSON-RPC method name");
	});

	test("parses neofetch-style fetch command", () => {
		expect(parseArgs(["--no-color", "fetch"], {})).toEqual({
			type: "fetch",
			appUrl: "ws://127.0.0.1:3585",
			workspaceUrl: "ws://127.0.0.1:3586",
			timeoutMs: 1500,
			color: false,
			json: false,
		});
		expect(parseArgs(["--json", "neofetch"], {})).toMatchObject({
			type: "fetch",
			json: true,
		});
	});

	test("formats fetch output without ANSI colors", () => {
		const info: FetchInfo = {
			package: "@peezy.tech/codex-flows",
			version: "0.3.1",
			runtime: "bun 1.3.11",
			node: "24.0.0",
			platform: "linux",
			arch: "x64",
			shell: "/bin/bash",
			cwd: "/workspace",
			mode: "code-mode",
			codexCommand: "/tmp/codex",
			appServerUrl: "ws://127.0.0.1:3585",
			workspaceBackendUrl: "ws://127.0.0.1:3586",
			codexHome: "/tmp/codex-home",
			backend: {
				mode: "workspace",
				status: "connected",
				url: "ws://127.0.0.1:3586",
				server: {
					name: "codex-workspace-backend-local",
					version: "0.1.0",
				},
				capabilities: {
					workspaceMethods: 8,
					flowInspection: true,
				},
				threads: {
					total: 2,
					active: 1,
					idle: 1,
					other: 0,
					latest: [
						{
							id: "thread_1234567890",
							label: "Implement CLI",
							status: "active",
						},
					],
				},
			},
		};
		const output = formatFetchInfo(info, { color: false });
		expect(output).toContain("codex-flows");
		expect(output).toContain("package      @peezy.tech/codex-flows@0.3.1");
		expect(output).toContain("workspace    ws://127.0.0.1:3586");
		expect(output).toContain("backend      workspace connected");
		expect(output).toContain("threads      2 listed, 1 active, 1 idle");
		expect(output).not.toContain("\x1b[");
	});
});
