import path from "node:path";
import { stepScriptPath } from "../manifest.ts";
import { parseFlowResult } from "../result.ts";
import type { FlowEvent, FlowResult, FlowRunContext, FlowStep, LoadedFlow } from "../types.ts";

export type RunBunStepOptions = {
	flow: LoadedFlow;
	step: FlowStep;
	event: FlowEvent;
	env?: Record<string, string | undefined>;
};

export async function runBunStep(options: RunBunStepOptions): Promise<FlowResult> {
	const scriptPath = stepScriptPath(options.flow, options.step);
	const cwd = options.step.cwd
		? path.resolve(options.flow.root, options.step.cwd)
		: options.flow.root;
	const subprocess = Bun.spawn({
		cmd: [process.execPath, scriptPath],
		cwd,
		env: {
			...process.env,
			...options.env,
		},
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	subprocess.stdin.write(`${JSON.stringify(runContext(options), null, 2)}\n`);
	subprocess.stdin.end();
	const timer = setTimeout(() => subprocess.kill("SIGTERM"), options.step.timeoutMs);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
		subprocess.exited,
	]).finally(() => clearTimeout(timer));
	if (exitCode !== 0) {
		throw new Error(`Bun flow step ${options.flow.manifest.name}/${options.step.name} failed:\n${stderr || stdout}`);
	}
	return parseFlowResult(stdout);
}

function runContext(options: RunBunStepOptions): FlowRunContext {
	return {
		flow: {
			name: options.flow.manifest.name,
			version: options.flow.manifest.version,
			root: options.flow.root,
			step: options.step.name,
			...(options.flow.manifest.config ? { config: options.flow.manifest.config } : {}),
			event: options.event,
		},
	};
}
