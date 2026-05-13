import type { FlowResult, FlowResultStatus } from "./types.ts";

const validStatuses = new Set<FlowResultStatus>([
	"skipped",
	"completed",
	"changed",
	"needs_intervention",
	"blocked",
	"failed",
]);

export function parseFlowResult(stdout: string): FlowResult {
	for (const line of stdout.split(/\r?\n/).reverse()) {
		const index = line.indexOf("FLOW_RESULT ");
		if (index === -1) {
			continue;
		}
		const text = line.slice(index + "FLOW_RESULT ".length).trim();
		const parsed = JSON.parse(text) as unknown;
		if (!isRecord(parsed)) {
			throw new Error("FLOW_RESULT must be a JSON object");
		}
		if (typeof parsed.status !== "string" || !validStatuses.has(parsed.status as FlowResultStatus)) {
			throw new Error("FLOW_RESULT status is invalid");
		}
		return parsed as FlowResult;
	}
	throw new Error("Step did not emit FLOW_RESULT");
}

export function stringifyFlowResult(value: FlowResult): string {
	return `FLOW_RESULT ${JSON.stringify(value)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
