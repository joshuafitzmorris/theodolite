// `theodolite report`: print a proposed theodolite.toml from what the code does. Writes nothing.

import { existsSync, readFileSync } from "node:fs";
import { proposeToml } from "./propose.ts";
import { begin, scanProject } from "./scan.ts";

const USAGE =
	"theodolite report [--root <dir>] [--config <file>]\n\n  prints a proposed theodolite.toml to stdout; writes nothing.\n  With a config, every existing line is kept and only new writers are appended.";

export async function run(argv: string[]): Promise<number> {
	const started = begin(argv, USAGE, true);
	if (typeof started === "number") return started;
	const { config } = started;
	const existing = existsSync(config.file) ? readFileSync(config.file, "utf8") : null;
	console.log(proposeToml(config, scanProject(config), existing).trimEnd());
	return 0;
}
