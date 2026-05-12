import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { parseConfig } from "../src/config.ts";

describe("parseConfig", () => {
	test("resolves --dir relative to the home directory", () => {
		const parsed = parseConfig(
			[
				"--token",
				"discord-token",
				"--allowed-user-ids",
				"user-1",
				"--dir",
				"projects/demo",
			],
			{},
		);

		expect(parsed.type).toBe("run");
		if (parsed.type === "run") {
			expect(parsed.config.cwd).toBe(path.join(os.homedir(), "projects/demo"));
		}
	});

	test("expands tilde dir paths from the home directory", () => {
		const parsed = parseConfig(
			[
				"--token",
				"discord-token",
				"--allowed-user-ids",
				"user-1",
				"--dir",
				"~/projects/demo",
			],
			{},
		);

		expect(parsed.type).toBe("run");
		if (parsed.type === "run") {
			expect(parsed.config.cwd).toBe(path.join(os.homedir(), "projects/demo"));
		}
	});

	test("accepts one positional directory for root script usage", () => {
		const parsed = parseConfig(
			[
				"--token",
				"discord-token",
				"--allowed-user-ids",
				"user-1",
				"--local-app-server",
				"~/game-protocol-workspace",
			],
			{ CODEX_DISCORD_DIR: "env-dir" },
		);

		expect(parsed.type).toBe("run");
		if (parsed.type === "run") {
			expect(parsed.localAppServer).toBe(true);
			expect(parsed.config.cwd).toBe(
				path.join(os.homedir(), "game-protocol-workspace"),
			);
		}
	});

	test("rejects multiple directory arguments", () => {
		expect(() =>
			parseConfig(
				[
					"--token",
					"discord-token",
					"--allowed-user-ids",
					"user-1",
					"one",
					"two",
				],
				{},
			)
		).toThrow("Unexpected argument: two");
		expect(() =>
			parseConfig(
				[
					"--token",
					"discord-token",
					"--allowed-user-ids",
					"user-1",
					"--dir",
					"one",
					"two",
				],
				{},
			)
		).toThrow("Cannot set both positional directory and --dir/--cwd.");
	});

	test("prefers CODEX_DISCORD_DIR over legacy cwd env", () => {
		const parsed = parseConfig(
			["--token", "discord-token", "--allowed-user-ids", "user-1"],
			{
				CODEX_DISCORD_DIR: "current",
				CODEX_DISCORD_CWD: "/legacy",
			},
		);

		expect(parsed.type).toBe("run");
		if (parsed.type === "run") {
			expect(parsed.config.cwd).toBe(path.join(os.homedir(), "current"));
		}
	});

	test("enables debug logging from flag or environment", () => {
		const fromFlag = parseConfig(
			["--token", "discord-token", "--allowed-user-ids", "user-1", "--debug"],
			{},
		);
		const fromEnv = parseConfig(
			["--token", "discord-token", "--allowed-user-ids", "user-1"],
			{ CODEX_DISCORD_DEBUG: "true" },
		);

		expect(fromFlag.type).toBe("run");
		expect(fromEnv.type).toBe("run");
		if (fromFlag.type === "run" && fromEnv.type === "run") {
			expect(fromFlag.config.debug).toBe(true);
			expect(fromEnv.config.debug).toBe(true);
		}
	});

	test("parses progress mode from flag or environment", () => {
		const fromFlag = parseConfig(
			[
				"--token",
				"discord-token",
				"--allowed-user-ids",
				"user-1",
				"--progress-mode",
				"commentary",
			],
			{},
		);
		const fromEnv = parseConfig(
			["--token", "discord-token", "--allowed-user-ids", "user-1"],
			{ CODEX_DISCORD_PROGRESS_MODE: "none" },
		);

		expect(fromFlag.type).toBe("run");
		expect(fromEnv.type).toBe("run");
		if (fromFlag.type === "run" && fromEnv.type === "run") {
			expect(fromFlag.config.progressMode).toBe("commentary");
			expect(fromEnv.config.progressMode).toBe("none");
		}
	});

	test("parses console output and log level from flag or environment", () => {
		const fromFlag = parseConfig(
			[
				"--token",
				"discord-token",
				"--allowed-user-ids",
				"user-1",
				"--console-output",
				"messages",
				"--log-level",
				"warn",
			],
			{},
		);
		const fromEnv = parseConfig(
			["--token", "discord-token", "--allowed-user-ids", "user-1"],
			{
				CODEX_DISCORD_CONSOLE_OUTPUT: "none",
				CODEX_DISCORD_LOG_LEVEL: "silent",
			},
		);

		expect(fromFlag.type).toBe("run");
		expect(fromEnv.type).toBe("run");
		if (fromFlag.type === "run" && fromEnv.type === "run") {
			expect(fromFlag.config.consoleOutput).toBe("messages");
			expect(fromFlag.config.logLevel).toBe("warn");
			expect(fromEnv.config.consoleOutput).toBe("none");
			expect(fromEnv.config.logLevel).toBe("silent");
		}
	});

	test("can force a local app-server even when workspace URL env is set", () => {
		const parsed = parseConfig(
			[
				"--token",
				"discord-token",
				"--allowed-user-ids",
				"user-1",
				"--local-app-server",
			],
			{ CODEX_WORKSPACE_APP_SERVER_WS_URL: "ws://127.0.0.1:9999" },
		);

		expect(parsed.type).toBe("run");
		if (parsed.type === "run") {
			expect(parsed.localAppServer).toBe(true);
			expect(parsed.appServerUrl).toBeUndefined();
		}
	});

	test("rejects mixing local and explicit external app-server modes", () => {
		expect(() =>
			parseConfig(
				[
					"--token",
					"discord-token",
					"--allowed-user-ids",
					"user-1",
					"--local-app-server",
					"--app-server-url",
					"ws://127.0.0.1:9999",
				],
				{},
			)
		).toThrow("Cannot set both --local-app-server and --app-server-url.");
	});
});
