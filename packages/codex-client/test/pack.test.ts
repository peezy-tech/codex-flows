import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	applyPackAdd,
	collectPackDoctor,
	inspectPackSource,
	listInstalledPacks,
	planPackAdd,
} from "../src/cli/pack.ts";

const fixtureRoot = path.join(import.meta.dir, "fixtures", "example-pack");

describe("pack installer", () => {
	test("inspects a manifest-backed pack and honors item names", async () => {
		const inspection = await inspectPackSource({ source: fixtureRoot });

		expect(inspection.pack).toMatchObject({
			name: "engineering-capabilities",
			version: "0.1.0",
		});
		expect(inspection.items.map((item) => `${item.kind}:${item.name}`).sort()).toEqual([
			"flow:release-health",
			"hook:workspace-stop",
			"plugin:repo-policy",
			"skill:tdd",
		]);
		expect(inspection.items.find((item) => item.name === "repo-policy")?.pluginHasHooks).toBe(true);
	});

	test("dry-run reports selected copies without writing workspace files", async () => {
		const workspaceRoot = await tempWorkspace();
		const plan = await planPackAdd({
			source: fixtureRoot,
			workspaceRoot,
			include: ["tdd", "release-health"],
		});

		expect(plan.apply).toBe(false);
		expect(plan.items.filter((item) => item.action === "add").map((item) => item.name).sort())
			.toEqual(["release-health", "tdd"]);
		expect(plan.items.filter((item) => item.action === "skip").map((item) => item.name).sort())
			.toEqual(["repo-policy", "workspace-stop"]);
		expect(await exists(path.join(workspaceRoot, ".agents", "skills", "tdd"))).toBe(false);
		expect(await exists(path.join(workspaceRoot, ".codex", "pack-lock.json"))).toBe(false);
	});

	test("apply installs capabilities, marketplace entries, hooks, and lockfile", async () => {
		const workspaceRoot = await tempWorkspace();
		const plan = await applyPackAdd({
			source: fixtureRoot,
			workspaceRoot,
			apply: true,
		});

		expect(plan.items.every((item) => item.action === "add")).toBe(true);
		expect(await readFile(path.join(workspaceRoot, ".agents", "skills", "tdd", "SKILL.md"), "utf8"))
			.toContain("# TDD");
		expect(await readFile(path.join(workspaceRoot, ".codex", "flows", "release-health", "flow.toml"), "utf8"))
			.toContain('name = "release-health"');
		expect(await readFile(path.join(workspaceRoot, "plugins", "repo-policy", ".codex-plugin", "plugin.json"), "utf8"))
			.toContain('"name": "repo-policy"');

		const marketplace = JSON.parse(
			await readFile(path.join(workspaceRoot, ".agents", "plugins", "marketplace.json"), "utf8"),
		) as { plugins: Array<{ name: string; source: { path: string } }> };
		expect(marketplace.plugins).toContainEqual(expect.objectContaining({
			name: "repo-policy",
			source: { source: "local", path: "./plugins/repo-policy" },
		}));

		const hooks = JSON.parse(
			await readFile(path.join(workspaceRoot, ".codex", "hooks.json"), "utf8"),
		) as { hooks: { PostToolUse: unknown[] }; codexPack: { hooks: Record<string, unknown> } };
		expect(hooks.hooks.PostToolUse).toHaveLength(1);
		expect(hooks.codexPack.hooks["workspace-stop"]).toBeDefined();

		const list = await listInstalledPacks({ workspaceRoot });
		expect(list.items.map((item) => `${item.kind}:${item.name}`).sort()).toEqual([
			"flow:release-health",
			"hook:workspace-stop",
			"plugin:repo-policy",
			"skill:tdd",
		]);

		const doctor = await collectPackDoctor({ workspaceRoot });
		expect(doctor.installedItems).toBe(4);
		expect(doctor.missingDestinations).toEqual([]);
		expect(doctor.marketplace.valid).toBe(true);
		expect(doctor.hooks.valid).toBe(true);
	});

	test("conflicts skip changed destinations and overwrite backs them up", async () => {
		const workspaceRoot = await tempWorkspace();
		await applyPackAdd({
			source: fixtureRoot,
			workspaceRoot,
			apply: true,
			include: ["tdd"],
		});
		const installedSkill = path.join(workspaceRoot, ".agents", "skills", "tdd", "SKILL.md");
		await writeFile(installedSkill, "workspace edit\n");

		const conflict = await planPackAdd({
			source: fixtureRoot,
			workspaceRoot,
			include: ["tdd"],
		});
		expect(conflict.items.find((item) => item.name === "tdd")?.action).toBe("conflict");

		const overwritten = await applyPackAdd({
			source: fixtureRoot,
			workspaceRoot,
			apply: true,
			overwrite: true,
			include: ["tdd"],
		});
		const tdd = overwritten.items.find((item) => item.name === "tdd");
		expect(tdd?.action).toBe("overwrite");
		expect(tdd?.backupPath).toBeDefined();
		expect(await readFile(path.join(tdd?.backupPath ?? "", "SKILL.md"), "utf8"))
			.toContain("workspace edit");
		expect(await readFile(installedSkill, "utf8")).toContain("# TDD");
	});

	test("discovers conventional layouts without codex-pack.toml", async () => {
		const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "codex-pack-source-"));
		await writeFixtureFile(sourceRoot, "skills/demo/SKILL.md", "# Demo\n");
		await writeFixtureFile(sourceRoot, "flows/demo-flow/flow.toml", [
			'name = "demo-flow"',
			"version = 1",
			"[[steps]]",
			'name = "check"',
			'runner = "bun"',
			'script = "check.ts"',
		].join("\n"));
		await writeFixtureFile(sourceRoot, "plugins/demo-plugin/.codex-plugin/plugin.json", '{"name":"demo-plugin"}');
		await writeFixtureFile(sourceRoot, "hooks/demo-hooks/hooks.json", '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo stop"}]}]}}');

		const inspection = await inspectPackSource({ source: sourceRoot });

		expect(inspection.items.map((item) => `${item.kind}:${item.name}`).sort()).toEqual([
			"flow:demo-flow",
			"hook:demo-hooks",
			"plugin:demo-plugin",
			"skill:demo",
		]);
	});
});

async function tempWorkspace(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "codex-pack-workspace-"));
	await mkdir(path.join(root, ".git"), { recursive: true });
	return root;
}

async function writeFixtureFile(root: string, relativePath: string, contents: string): Promise<void> {
	const fullPath = path.join(root, relativePath);
	await mkdir(path.dirname(fullPath), { recursive: true });
	await writeFile(fullPath, contents);
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}
