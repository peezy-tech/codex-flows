import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { flowEventArg, flowStepArg } from "./schema.js";

const runStatusArg = v.union(
	v.literal("queued"),
	v.literal("running"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("canceled"),
);

export const syncFlowManifest = mutation({
	args: {
		name: v.string(),
		version: v.number(),
		description: v.optional(v.string()),
		root: v.optional(v.string()),
		config: v.optional(v.any()),
		steps: v.array(flowStepArg),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const existing = await ctx.db
			.query("flowManifests")
			.withIndex("by_name", (q) => q.eq("name", args.name))
			.unique();
		const manifest = {
			name: args.name,
			version: args.version,
			description: args.description,
			root: args.root,
			config: args.config,
			steps: args.steps,
			syncedAt: now,
			updatedAt: now,
		};
		if (existing) {
			await ctx.db.patch(existing._id, manifest);
			return { manifestId: existing._id, status: "updated" };
		}
		return {
			manifestId: await ctx.db.insert("flowManifests", manifest),
			status: "created",
		};
	},
});

export const dispatchEvent = mutation({
	args: {
		event: flowEventArg,
	},
	handler: async (ctx, args) => {
		return dispatchFlowEvent(ctx, { event: args.event });
	},
});

export const replayEvent = mutation({
	args: {
		eventId: v.string(),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("flowEvents")
			.withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
			.unique();
		if (!existing) {
			throw new Error(`Unknown flow event: ${args.eventId}`);
		}
		return dispatchFlowEvent(ctx, {
			event: existing.raw,
			replayNonce: String(Date.now()),
		});
	},
});

export const claimRun = mutation({
	args: {
		workerId: v.string(),
		leaseMs: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const expired = await ctx.db
			.query("flowRunAttempts")
			.withIndex("by_status_lease", (q) =>
				q.eq("status", "running").lt("leaseExpiresAt", now),
			)
			.first();
		if (expired) {
			await ctx.db.patch(expired._id, {
				status: "failed",
				error: "Lease expired before worker heartbeat.",
				updatedAt: now,
				completedAt: now,
			});
			const expiredRun = await runById(ctx, expired.runId);
			if (expiredRun && expiredRun.status === "running") {
				return claimExistingRun(ctx, expiredRun, args.workerId, leaseMs(args.leaseMs));
			}
		}

		const queued = await ctx.db
			.query("flowRuns")
			.withIndex("by_status_created", (q) => q.eq("status", "queued"))
			.order("asc")
			.first();
		if (!queued) return null;
		return claimExistingRun(ctx, queued, args.workerId, leaseMs(args.leaseMs));
	},
});

export const heartbeatRun = mutation({
	args: {
		attemptId: v.string(),
		leaseToken: v.string(),
		leaseMs: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const attempt = await assertAttemptLease(ctx, args.attemptId, args.leaseToken);
		const now = Date.now();
		const nextLeaseExpiresAt = now + leaseMs(args.leaseMs);
		await ctx.db.patch(attempt._id, {
			leaseExpiresAt: nextLeaseExpiresAt,
			lastHeartbeatAt: now,
			updatedAt: now,
		});
		return { status: "running", leaseExpiresAt: nextLeaseExpiresAt };
	},
});

export const appendRunOutput = mutation({
	args: {
		attemptId: v.string(),
		leaseToken: v.string(),
		kind: v.union(
			v.literal("system"),
			v.literal("stdout"),
			v.literal("stderr"),
			v.literal("agent"),
		),
		text: v.string(),
	},
	handler: async (ctx, args) => {
		const attempt = await assertAttemptLease(ctx, args.attemptId, args.leaseToken);
		return ctx.db.insert("flowOutputEvents", {
			attemptId: args.attemptId,
			runId: attempt.runId,
			kind: args.kind,
			text: args.text,
			createdAt: Date.now(),
		});
	},
});

export const completeRun = mutation({
	args: {
		attemptId: v.string(),
		leaseToken: v.string(),
		result: v.any(),
	},
	handler: async (ctx, args) => {
		const attempt = await assertAttemptLease(ctx, args.attemptId, args.leaseToken);
		const run = await runById(ctx, attempt.runId);
		if (!run) throw new Error(`Unknown flow run: ${attempt.runId}`);
		const now = Date.now();
		await ctx.db.patch(attempt._id, {
			status: "completed",
			result: args.result,
			updatedAt: now,
			completedAt: now,
		});
		await ctx.db.patch(run._id, {
			status: "completed",
			result: args.result,
			updatedAt: now,
			completedAt: now,
		});
		return { status: "completed", runId: attempt.runId };
	},
});

export const failRun = mutation({
	args: {
		attemptId: v.string(),
		leaseToken: v.string(),
		error: v.string(),
	},
	handler: async (ctx, args) => {
		const attempt = await assertAttemptLease(ctx, args.attemptId, args.leaseToken);
		const run = await runById(ctx, attempt.runId);
		if (!run) throw new Error(`Unknown flow run: ${attempt.runId}`);
		const now = Date.now();
		await ctx.db.patch(attempt._id, {
			status: "failed",
			error: args.error,
			updatedAt: now,
			completedAt: now,
		});
		await ctx.db.patch(run._id, {
			status: "failed",
			error: args.error,
			updatedAt: now,
			completedAt: now,
		});
		return { status: "failed", runId: attempt.runId };
	},
});

export const cancelRun = mutation({
	args: {
		runId: v.string(),
	},
	handler: async (ctx, args) => {
		const run = await runById(ctx, args.runId);
		if (!run) throw new Error(`Unknown flow run: ${args.runId}`);
		if (run.status === "completed") {
			throw new Error(`Cannot cancel completed flow run: ${args.runId}`);
		}
		const now = Date.now();
		await ctx.db.patch(run._id, {
			status: "canceled",
			updatedAt: now,
			completedAt: now,
		});
		return { status: "canceled", runId: args.runId };
	},
});

export const listEvents = query({
	args: {
		type: v.optional(v.string()),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const limit = clampLimit(args.limit);
		const eventType = args.type;
		if (eventType) {
			return ctx.db
				.query("flowEvents")
				.withIndex("by_type_created", (q) => q.eq("type", eventType))
				.order("desc")
				.take(limit);
		}
		return ctx.db.query("flowEvents").order("desc").take(limit);
	},
});

export const getEvent = query({
	args: {
		eventId: v.string(),
	},
	handler: async (ctx, args) => {
		const event = await ctx.db
			.query("flowEvents")
			.withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
			.unique();
		if (!event) return null;
		const runs = await ctx.db
			.query("flowRuns")
			.withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
			.collect();
		return { ...event, runs };
	},
});

export const listRuns = query({
	args: {
		eventId: v.optional(v.string()),
		status: v.optional(runStatusArg),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const limit = clampLimit(args.limit);
		const eventId = args.eventId;
		if (eventId) {
			return ctx.db
				.query("flowRuns")
				.withIndex("by_event_id", (q) => q.eq("eventId", eventId))
				.order("desc")
				.take(limit);
		}
		const status = args.status;
		if (status) {
			return ctx.db
				.query("flowRuns")
				.withIndex("by_status_created", (q) => q.eq("status", status))
				.order("desc")
				.take(limit);
		}
		return ctx.db.query("flowRuns").order("desc").take(limit);
	},
});

export const getRun = query({
	args: {
		runId: v.string(),
	},
	handler: async (ctx, args) => {
		const run = await runById(ctx, args.runId);
		if (!run) return null;
		const attempts = await ctx.db
			.query("flowRunAttempts")
			.withIndex("by_run_id", (q) => q.eq("runId", args.runId))
			.collect();
		const output = await ctx.db
			.query("flowOutputEvents")
			.withIndex("by_run", (q) => q.eq("runId", args.runId))
			.order("asc")
			.take(500);
		return { ...run, attempts, output };
	},
});

async function dispatchFlowEvent(
	ctx: any,
	args: {
		event: {
			id: string;
			type: string;
			source?: string;
			occurredAt?: string;
			receivedAt?: string;
			payload: any;
		};
		replayNonce?: string;
	},
) {
	const now = Date.now();
	const event = {
		...args.event,
		receivedAt: args.event.receivedAt ?? new Date(now).toISOString(),
	};
	const existing = await ctx.db
		.query("flowEvents")
		.withIndex("by_event_id", (q: any) => q.eq("eventId", event.id))
		.unique();
	if (existing && !args.replayNonce) {
		const runs = await ctx.db
			.query("flowRuns")
			.withIndex("by_event_id", (q: any) => q.eq("eventId", event.id))
			.collect();
		return {
			status: "duplicate",
			eventId: event.id,
			runIds: runs.map((run: any) => run.runId),
			matched: 0,
		};
	}

	if (!existing) {
		await ctx.db.insert("flowEvents", {
			eventId: event.id,
			type: event.type,
			source: event.source,
			occurredAt: event.occurredAt,
			receivedAt: event.receivedAt,
			payload: event.payload,
			raw: event,
			createdAt: now,
		});
	}

	const manifests = await ctx.db.query("flowManifests").collect();
	const matches = [];
	for (const manifest of manifests) {
		for (const step of manifest.steps) {
			if (step.trigger?.type === event.type) {
				matches.push({ manifest, step });
			}
		}
	}

	const runIds: string[] = [];
	for (const match of matches) {
		const runId = flowRunId(event.id, match.manifest.name, match.step.name, args.replayNonce);
		const existingRun = await runById(ctx, runId);
		if (existingRun) {
			runIds.push(existingRun.runId);
			continue;
		}
		await ctx.db.insert("flowRuns", {
			runId,
			eventId: event.id,
			flowName: match.manifest.name,
			flowVersion: match.manifest.version,
			stepName: match.step.name,
			runner: match.step.runner,
			status: "queued",
			attemptCount: 0,
			createdAt: now,
			updatedAt: now,
		});
		runIds.push(runId);
	}

	return {
		status: "accepted",
		eventId: event.id,
		runIds,
		matched: matches.length,
	};
}

async function claimExistingRun(
	ctx: any,
	run: any,
	workerId: string,
	leaseDurationMs: number,
) {
	const now = Date.now();
	const attemptNumber = run.attemptCount + 1;
	const attemptId = `${run.runId}:attempt:${attemptNumber}`;
	const leaseToken = `${attemptId}:${workerId}:${now}`;
	await ctx.db.insert("flowRunAttempts", {
		attemptId,
		runId: run.runId,
		eventId: run.eventId,
		flowName: run.flowName,
		stepName: run.stepName,
		attemptNumber,
		status: "running",
		workerId,
		leaseToken,
		leaseExpiresAt: now + leaseDurationMs,
		lastHeartbeatAt: now,
		createdAt: now,
		updatedAt: now,
	});
	await ctx.db.patch(run._id, {
		status: "running",
		attemptCount: attemptNumber,
		latestAttemptId: attemptId,
		startedAt: run.startedAt ?? now,
		updatedAt: now,
	});

	const event = await ctx.db
		.query("flowEvents")
		.withIndex("by_event_id", (q: any) => q.eq("eventId", run.eventId))
		.unique();
	return {
		runId: run.runId,
		attemptId,
		leaseToken,
		leaseExpiresAt: now + leaseDurationMs,
		flowName: run.flowName,
		stepName: run.stepName,
		runner: run.runner,
		event: event?.raw,
	};
}

async function assertAttemptLease(ctx: any, attemptId: string, leaseToken: string) {
	const attempt = await ctx.db
		.query("flowRunAttempts")
		.withIndex("by_attempt_id", (q: any) => q.eq("attemptId", attemptId))
		.unique();
	if (!attempt) throw new Error(`Unknown flow run attempt: ${attemptId}`);
	if (attempt.status !== "running" || attempt.leaseToken !== leaseToken) {
		throw new Error("Flow run attempt is not leased by this worker.");
	}
	if (attempt.leaseExpiresAt < Date.now()) {
		throw new Error("Flow run attempt lease expired.");
	}
	return attempt;
}

async function runById(ctx: any, runId: string) {
	return ctx.db
		.query("flowRuns")
		.withIndex("by_run_id", (q: any) => q.eq("runId", runId))
		.unique();
}

function flowRunId(
	eventId: string,
	flowName: string,
	stepName: string,
	replayNonce?: string,
): string {
	return [
		"run",
		safeId(eventId),
		safeId(flowName),
		safeId(stepName),
		...(replayNonce ? [safeId(replayNonce), "replay"] : []),
	].join(":");
}

function safeId(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			|| "item"
	);
}

function leaseMs(value: number | undefined): number {
	return Math.max(10_000, Math.min(value ?? 120_000, 30 * 60_000));
}

function clampLimit(value: number | undefined): number {
	if (!value || !Number.isFinite(value)) return 50;
	return Math.max(1, Math.min(Math.trunc(value), 500));
}
