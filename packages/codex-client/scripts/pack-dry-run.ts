type PackFile = {
	path: string;
	size: number;
};

type PackResult = {
	name: string;
	version: string;
	filename: string;
	files: PackFile[];
	unpackedSize: number;
	size: number;
};

const proc = Bun.spawn(["npm", "pack", "--dry-run", "--json"], {
	stdout: "pipe",
	stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
	new Response(proc.stdout).text(),
	new Response(proc.stderr).text(),
	proc.exited,
]);

if (exitCode !== 0) {
	process.stderr.write(stderr);
	process.stderr.write(stdout);
	process.exit(exitCode);
}

const results = JSON.parse(stdout) as PackResult[];
const result = results[0];

if (!result) {
	throw new Error("npm pack did not return package metadata");
}

const byTopLevel = new Map<string, number>();
for (const file of result.files) {
	const [topLevel = file.path] = file.path.split("/");
	byTopLevel.set(topLevel, (byTopLevel.get(topLevel) ?? 0) + 1);
}

const topLevelSummary = [...byTopLevel.entries()]
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([name, count]) => `${name}: ${count}`)
	.join(", ");

console.log(`${result.name}@${result.version}`);
console.log(`tarball: ${result.filename}`);
console.log(`files: ${result.files.length} (${topLevelSummary})`);
console.log(`package size: ${formatBytes(result.size)}`);
console.log(`unpacked size: ${formatBytes(result.unpackedSize)}`);

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	const kib = bytes / 1024;
	if (kib < 1024) {
		return `${kib.toFixed(1)} KiB`;
	}

	return `${(kib / 1024).toFixed(1)} MiB`;
}
