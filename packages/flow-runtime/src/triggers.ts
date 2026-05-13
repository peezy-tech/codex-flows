import { stepSchemaPath } from "./manifest.ts";
import { readJsonSchema, validateJsonSchema } from "./schema.ts";
import type { FlowEvent, FlowStep, LoadedFlow } from "./types.ts";

export type TriggerMatch =
	| { ok: true }
	| { ok: false; reason: string };

export async function stepMatchesEvent(
	flow: LoadedFlow,
	step: FlowStep,
	event: FlowEvent,
): Promise<TriggerMatch> {
	if (!step.trigger) {
		return { ok: false, reason: "step has no trigger" };
	}
	if (step.trigger.type !== event.type) {
		return { ok: false, reason: `event type ${event.type} does not match ${step.trigger.type}` };
	}
	const schemaPath = stepSchemaPath(flow, step);
	if (!schemaPath) {
		return { ok: true };
	}
	const result = validateJsonSchema(event.payload, await readJsonSchema(schemaPath));
	return result.ok ? { ok: true } : { ok: false, reason: result.errors.join("; ") };
}

export async function matchingSteps(
	flows: LoadedFlow[],
	event: FlowEvent,
): Promise<Array<{ flow: LoadedFlow; step: FlowStep }>> {
	const matches: Array<{ flow: LoadedFlow; step: FlowStep }> = [];
	for (const flow of flows) {
		for (const step of flow.manifest.steps) {
			if ((await stepMatchesEvent(flow, step, event)).ok) {
				matches.push({ flow, step });
			}
		}
	}
	return matches;
}
