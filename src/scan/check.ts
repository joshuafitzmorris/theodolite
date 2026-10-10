// `theodolite check`: scan against theodolite.toml and print findings. With --base, only what changed.

import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { scanChanged } from "./diff.ts";
import { type Config, loadConfig } from "./matrix.ts";
import { humanOutput, jsonOutput, summarize } from "./output.ts";
import type { Finding, ResolveResult } from "./resolve.ts";
import { begin, scanProject } from "./scan.ts";

const USAGE = `theodolite check [--root <dir>] [--config <file>] [--json] [--strict] [--base <ref>]

  exit 0 clean or warnings only, 1 errors, 2 usage or config error
  --strict      warnings count as errors, including a [grandfathered] table that grew since the committed theodolite.toml
  --base <ref>  scan only the files changed since <ref>, count only new write sites, and print the door verdict`;

export async function run(argv: string[]): Promise<number> {
	const started = begin(argv, USAGE, false);
	if (typeof started === "number") return started;
	const { args, config } = started;
	let result: ResolveResult;
	let doors: string[] | undefined;
	let ref = "HEAD";
	if (args.base !== undefined) {
		const scanned = scanChanged(config, args.base, args.strict);
		if ("error" in scanned) {
			console.error(scanned.error);
			return 2;
		}
		result = scanned.result;
		doors = scanned.doors;
		ref = scanned.mergeBase;
	} else {
		result = scanProject(config, args.strict);
	}
	const grew = grandfatheredGrowth(config, ref, args.strict);
	if (grew) result.findings.push(grew);
	console.log(args.json ? jsonOutput(result, doors) : humanOutput(result, doors));
	if (result.files === 0 && doors === undefined) {
		// A brand-new repository has nothing to scan yet; that is a warning, not a failure.
		// Under --strict an empty include is an error, because in CI it usually means a wrong path.
		console.error(
			`theodolite.toml: warning: include matched no files (include = ${JSON.stringify(config.include)})`,
		);
		return args.strict ? 1 : 0;
	}
	return summarize(result).errors > 0 ? 1 : 0;
}

/** A [grandfathered] table with more pairs than the theodolite.toml at `ref`: a warning, an error under --strict. */
export function grandfatheredGrowth(cfg: Config, ref: string, strict: boolean): Finding | null {
	const count = (c: Config) => c.grandfathered.reduce((n, g) => n + g.resources.length, 0);
	const now = count(cfg);
	if (now === 0) return null;
	const run = (args: string[]) => spawnSync("git", args, { cwd: cfg.dir, encoding: "utf8" });
	const prefix = run(["rev-parse", "--show-prefix"]);
	if (prefix.status !== 0) return null;
	const shown = run(["show", `${ref}:${prefix.stdout.trim()}${basename(cfg.file)}`]);
	if (shown.status !== 0) return null;
	const loaded = loadConfig(shown.stdout, cfg.file);
	if (!loaded.ok) return null;
	const before = count(loaded.config);
	if (now <= before) return null;
	return {
		rule: "grandfathered-grew",
		severity: strict ? "error" : "warning",
		file: basename(cfg.file),
		line: cfg.grandfathered[0]?.line ?? 1,
		col: 1,
		resource: null,
		target: "",
		via: "",
		family: "grandfathered-grew",
		confidence: "high",
		fix: null,
		message: `[grandfathered] grew from ${before} to ${now} pairs since ${ref === "HEAD" ? "HEAD" : "the base"}. Shrink it, or say in the PR why.`,
	};
}
