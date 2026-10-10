// Orchestration shared by `check` and `report`: find and load the config, walk, scan, resolve.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { scanFile, setupFor } from "./detect.ts";
import { type Config, emptyConfig, loadConfig } from "./matrix.ts";
import { PRESETS } from "./presets/index.ts";
import { type ResolveResult, resolveAll } from "./resolve.ts";
import { readSource, walk } from "./walk.ts";

export type Args = {
	root: string;
	config: string | undefined;
	json: boolean;
	strict: boolean;
	help: boolean;
};

export function parseArgv(argv: string[]): Args | string {
	const flag = { type: "boolean" } as const;
	const text = { type: "string" } as const;
	try {
		const options = {
			root: text,
			config: text,
			json: flag,
			strict: flag,
			help: { ...flag, short: "h" },
		} as const;
		const { values: v } = parseArgs({ args: argv, allowPositionals: false, options });
		const config = v.config ? resolve(v.config) : undefined;
		return {
			root: resolve(v.root ?? "."),
			config,
			json: !!v.json,
			strict: !!v.strict,
			help: !!v.help,
		};
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

/** Walk up from `start` looking for theodolite.toml. */
export function findConfig(start: string): string | null {
	for (let dir = start; ; dir = dirname(dir)) {
		const candidate = join(dir, "theodolite.toml");
		if (existsSync(candidate)) return candidate;
		if (dirname(dir) === dir) return null;
	}
}

/** Load the config for a command; `optional` lets `report` run with none. */
function loadFor(args: Args, optional: boolean): { config: Config } | { error: string } {
	const file = args.config ?? findConfig(args.root);
	if (!file || !existsSync(file)) {
		if (optional) return { config: emptyConfig(args.root) };
		return {
			error: `theodolite.toml not found from ${args.root} upward. Run theodolite init, or pass --config.`,
		};
	}
	const loaded = loadConfig(readFileSync(file, "utf8"), file);
	if (loaded.ok) return { config: loaded.config };
	return { error: loaded.errors.map((e) => `${basename(file)}:${e.line}:${e.col}  ${e.message}`).join("\n") };
}

/** Parse arguments and load the config. A number is the exit code when the command should stop. */
export function begin(
	argv: string[],
	usage: string,
	optional: boolean,
): { args: Args; config: Config } | number {
	const args = parseArgv(argv);
	if (typeof args === "string") {
		console.error(`${args}\n\n${usage}`);
		return 2;
	}
	if (args.help) {
		console.log(usage);
		return 0;
	}
	const loaded = loadFor(args, optional);
	if ("error" in loaded) {
		console.error(loaded.error);
		return 2;
	}
	return { args, config: loaded.config };
}

export function scanProject(cfg: Config, strict = false): ResolveResult {
	const setup = setupFor(cfg);
	const files = walk(cfg);
	const scanned: Parameters<typeof resolveAll>[1] = [];
	for (const f of files) {
		const source = readSource(f);
		if (source === null) continue;
		const facts = scanFile(PRESETS[f.lang], source, f.path, setup);
		if (facts) scanned.push({ path: f.path, facts });
	}
	return resolveAll(cfg, scanned, files.length, strict);
}
