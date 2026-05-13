export const CODEX_FLOWS_CODE_MODE = "code-mode";
export const DEFAULT_CODE_MODE_CODEX_PACKAGE = "@peezy.tech/codex";

export function codexFlowsMode(
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const value = env.CODEX_FLOWS_MODE?.trim().toLowerCase();
	return value || undefined;
}

export function codexFlowsCodeModeEnabled(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return booleanEnv(env.CODEX_FLOWS_ENABLE_CODE_MODE) || codexFlowsMode(env) === CODEX_FLOWS_CODE_MODE;
}

function booleanEnv(value: string | undefined): boolean {
	const normalized = value?.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
