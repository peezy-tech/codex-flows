import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import type { FlowEvent } from "@peezy.tech/flow-runtime";

export type FlowRunStatus = "queued" | "running" | "completed" | "failed";

export type FlowRunRecord = {
	id: string;
	eventId: string;
	flowName: string;
	stepName: string;
	status: FlowRunStatus;
	backend: "systemd-local";
	executor: string;
	unit?: string;
	eventPath: string;
	commandJson?: string;
	resultJson?: string;
	stdout?: string;
	stderr?: string;
	error?: string;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
};

export class FlowBackendStore {
	readonly dbPath: string;
	#db: Database;

	constructor(dbPath: string) {
		this.dbPath = dbPath;
		mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = new Database(dbPath);
		this.#db.exec(`
			create table if not exists flow_events (
				id text primary key,
				type text not null,
				source text,
				occurred_at text,
				received_at text not null,
				payload_json text not null,
				raw_json text not null,
				created_at text not null
			);
			create table if not exists flow_runs (
				id text primary key,
				event_id text not null,
				flow_name text not null,
				step_name text not null,
				status text not null,
				backend text not null,
				executor text not null,
				unit text,
				event_path text not null,
				command_json text,
				result_json text,
				stdout text,
				stderr text,
				error text,
				created_at text not null,
				started_at text,
				completed_at text
			);
			create index if not exists flow_runs_event_id_idx on flow_runs(event_id);
		`);
	}

	insertEvent(event: FlowEvent): boolean {
		const result = this.#db
			.query(
				`insert or ignore into flow_events
					(id, type, source, occurred_at, received_at, payload_json, raw_json, created_at)
					values ($id, $type, $source, $occurredAt, $receivedAt, $payloadJson, $rawJson, $createdAt)`,
			)
			.run({
				$id: event.id,
				$type: event.type,
				$source: event.source ?? null,
				$occurredAt: event.occurredAt ?? null,
				$receivedAt: event.receivedAt,
				$payloadJson: JSON.stringify(event.payload),
				$rawJson: JSON.stringify(event),
				$createdAt: new Date().toISOString(),
			});
		return result.changes > 0;
	}

	createRun(record: FlowRunRecord): void {
		this.#db
			.query(
				`insert into flow_runs
					(id, event_id, flow_name, step_name, status, backend, executor, unit, event_path,
						command_json, result_json, stdout, stderr, error, created_at, started_at, completed_at)
					values
					($id, $eventId, $flowName, $stepName, $status, $backend, $executor, $unit, $eventPath,
						$commandJson, $resultJson, $stdout, $stderr, $error, $createdAt, $startedAt, $completedAt)`,
			)
			.run(runParams(record));
	}

	markRunRunning(id: string, commandJson: string, unit?: string): void {
		this.#db
			.query(
				`update flow_runs
					set status = 'running', started_at = $startedAt, command_json = $commandJson, unit = $unit
					where id = $id`,
			)
			.run({
				$id: id,
				$startedAt: new Date().toISOString(),
				$commandJson: commandJson,
				$unit: unit ?? null,
			});
	}

	markRunCompleted(id: string, values: { status: FlowRunStatus; resultJson?: string; stdout: string; stderr: string; error?: string }): void {
		this.#db
			.query(
				`update flow_runs
					set status = $status, completed_at = $completedAt, result_json = $resultJson,
						stdout = $stdout, stderr = $stderr, error = $error
					where id = $id`,
			)
			.run({
				$id: id,
				$status: values.status,
				$completedAt: new Date().toISOString(),
				$resultJson: values.resultJson ?? null,
				$stdout: values.stdout,
				$stderr: values.stderr,
				$error: values.error ?? null,
			});
	}

	listRunsByEvent(eventId: string): FlowRunRecord[] {
		return this.#db
			.query("select * from flow_runs where event_id = $eventId order by created_at, id")
			.all({ $eventId: eventId })
			.map(rowToRunRecord);
	}

	close(): void {
		this.#db.close();
	}
}

function runParams(record: FlowRunRecord): Record<string, string | null> {
	return {
		$id: record.id,
		$eventId: record.eventId,
		$flowName: record.flowName,
		$stepName: record.stepName,
		$status: record.status,
		$backend: record.backend,
		$executor: record.executor,
		$unit: record.unit ?? null,
		$eventPath: record.eventPath,
		$commandJson: record.commandJson ?? null,
		$resultJson: record.resultJson ?? null,
		$stdout: record.stdout ?? null,
		$stderr: record.stderr ?? null,
		$error: record.error ?? null,
		$createdAt: record.createdAt,
		$startedAt: record.startedAt ?? null,
		$completedAt: record.completedAt ?? null,
	};
}

function rowToRunRecord(row: unknown): FlowRunRecord {
	if (!isRecord(row)) {
		throw new Error("invalid run row");
	}
	return {
		id: String(row.id),
		eventId: String(row.event_id),
		flowName: String(row.flow_name),
		stepName: String(row.step_name),
		status: String(row.status) as FlowRunStatus,
		backend: "systemd-local",
		executor: String(row.executor),
		...(typeof row.unit === "string" ? { unit: row.unit } : {}),
		eventPath: String(row.event_path),
		...(typeof row.command_json === "string" ? { commandJson: row.command_json } : {}),
		...(typeof row.result_json === "string" ? { resultJson: row.result_json } : {}),
		...(typeof row.stdout === "string" ? { stdout: row.stdout } : {}),
		...(typeof row.stderr === "string" ? { stderr: row.stderr } : {}),
		...(typeof row.error === "string" ? { error: row.error } : {}),
		createdAt: String(row.created_at),
		...(typeof row.started_at === "string" ? { startedAt: row.started_at } : {}),
		...(typeof row.completed_at === "string" ? { completedAt: row.completed_at } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
