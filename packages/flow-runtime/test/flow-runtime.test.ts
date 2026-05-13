import { expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	discoverFlows,
	matchingSteps,
	runBunStep,
	runFlowStep,
	validateJsonSchema,
} from "../src/index.ts";
import { codeModeEnabled } from "../src/run.ts";
import type { FlowEvent } from "../src/index.ts";

test("discovers installed flows before source flows", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "flow-runtime-"));
	try {
		await writeFlow(directory, ".codex/flows/demo", "installed");
		await writeFlow(directory, "flows/demo", "source");

		const flows = await discoverFlows({ cwd: directory });

		expect(flows.map((flow) => flow.manifest.name)).toEqual(["demo"]);
		expect(flows[0]?.manifest.description).toBe("installed");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("matches flow steps by event type and payload schema", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "flow-runtime-"));
	try {
		await writeFlow(directory, "flows/demo", "source");
		const flows = await discoverFlows({ cwd: directory });
		const event: FlowEvent = {
			id: "event-1",
			type: "demo.event",
			receivedAt: "2026-05-13T00:00:00.000Z",
			payload: { name: "Ada" },
		};

		expect((await matchingSteps(flows, event)).map(({ step }) => step.name)).toEqual([
			"hello",
		]);
		expect(await matchingSteps(flows, { ...event, payload: {} })).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("bundled Codex release flows match one generic upstream release event", async () => {
	const root = path.resolve(import.meta.dir, "..", "..", "..");
	const flows = await discoverFlows({ cwd: root });
	const event: FlowEvent = {
		id: "event-1",
		type: "upstream.release",
		receivedAt: "2026-05-13T00:00:00.000Z",
		payload: { repo: "openai/codex", tag: "rust-v1.2.3" },
	};

	const matches = await matchingSteps(flows, event);

	expect(matches.map(({ flow, step }) => `${flow.manifest.name}/${step.name}`)).toEqual([
		"openai-codex-bindings/regenerate-bindings",
		"peezy-codex-fork/rebase-patch-stack",
	]);
});

test("bundled Code Mode flow remains gated by the feature flag", async () => {
	const root = path.resolve(import.meta.dir, "..", "..", "..");
	const flows = await discoverFlows({ cwd: root });
	const flow = flows.find((entry) => entry.manifest.name === "peezy-codex-fork");
	const step = flow?.manifest.steps.find((entry) => entry.name === "rebase-patch-stack");
	if (!flow || !step) {
		throw new Error("expected bundled peezy-codex-fork flow");
	}

	await expect(
		runFlowStep({
			flow,
			step,
			event: {
				id: "event-1",
				type: "upstream.release",
				receivedAt: "2026-05-13T00:00:00.000Z",
				payload: { repo: "openai/codex", tag: "rust-v1.2.3" },
			},
			env: {},
		}),
	).rejects.toThrow("requires CODEX_FLOWS_ENABLE_CODE_MODE=1");
});

test("CODEX_FLOWS_MODE=code-mode enables Code Mode flow steps", () => {
	expect(codeModeEnabled({})).toBe(false);
	expect(codeModeEnabled({ CODEX_FLOWS_ENABLE_CODE_MODE: "1" })).toBe(true);
	expect(codeModeEnabled({ CODEX_FLOWS_MODE: "code-mode" })).toBe(true);
});

test("validates simple JSON schema constraints", () => {
	const schema = {
		type: "object",
		required: ["name"],
		properties: {
			name: { type: "string" },
			kind: { enum: ["demo"] },
		},
	};

	expect(validateJsonSchema({ name: "Ada", kind: "demo" }, schema)).toEqual({ ok: true });
	expect(validateJsonSchema({ kind: "other" }, schema)).toEqual({
		ok: false,
		errors: ["$.name is required", "$.kind must be one of demo"],
	});
});

test("runs Bun flow steps and parses FLOW_RESULT", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "flow-runtime-"));
	try {
		await writeFlow(directory, "flows/demo", "source");
		const [flow] = await discoverFlows({ cwd: directory });
		const step = flow?.manifest.steps[0];
		if (!flow || !step) {
			throw new Error("expected fixture flow");
		}

		const result = await runBunStep({
			flow,
			step,
			event: {
				id: "event-1",
				type: "demo.event",
				receivedAt: "2026-05-13T00:00:00.000Z",
				payload: { name: "Ada" },
			},
		});

		expect(result).toEqual({
			status: "completed",
			message: "hello Ada",
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("requires a feature flag before running Code Mode flow steps", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "flow-runtime-"));
	try {
		await writeFlow(directory, "flows/demo", "source");
		const [flow] = await discoverFlows({ cwd: directory });
		const step = flow?.manifest.steps[0];
		if (!flow || !step) {
			throw new Error("expected fixture flow");
		}

		await expect(
			runFlowStep({
				flow,
				step: { ...step, runner: "code-mode" },
				event: {
					id: "event-1",
					type: "demo.event",
					receivedAt: "2026-05-13T00:00:00.000Z",
					payload: { name: "Ada" },
				},
				env: {},
			}),
		).rejects.toThrow("requires CODEX_FLOWS_ENABLE_CODE_MODE=1");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

async function writeFlow(root: string, relative: string, description: string): Promise<void> {
	const flowRoot = path.join(root, relative);
	await mkdir(path.join(flowRoot, "exec"), { recursive: true });
	await mkdir(path.join(flowRoot, "schemas"), { recursive: true });
	await Bun.write(
		path.join(flowRoot, "flow.toml"),
		[
			'name = "demo"',
			"version = 1",
			`description = "${description}"`,
			"",
			"[[steps]]",
			'name = "hello"',
			'runner = "bun"',
			'script = "exec/hello.ts"',
			"timeout_ms = 30000",
			"",
			"[steps.trigger]",
			'type = "demo.event"',
			'schema = "schemas/demo-event.schema.json"',
			"",
		].join("\n"),
	);
	await Bun.write(
		path.join(flowRoot, "schemas/demo-event.schema.json"),
		JSON.stringify({
			type: "object",
			required: ["name"],
			properties: {
				name: { type: "string" },
			},
		}),
	);
	await Bun.write(
		path.join(flowRoot, "exec/hello.ts"),
		[
			"const context = JSON.parse(await Bun.stdin.text());",
			"const name = context.flow.event.payload.name;",
			"console.log(`FLOW_RESULT ${JSON.stringify({ status: 'completed', message: `hello ${name}` })}`);",
			"",
		].join("\n"),
	);
}
