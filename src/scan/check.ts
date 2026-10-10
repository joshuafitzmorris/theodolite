// `theodolite check`: scan against theodolite.toml and print findings.

import { architectureSection, humanOutput, jsonOutput, summarize } from "./output.ts";
import { begin, scanProject } from "./scan.ts";

const USAGE = `theodolite check [--root <dir>] [--config <file>] [--json] [--strict] [--architecture]

  exit 0 clean or warnings only, 1 errors, 2 usage or config error, or no files scanned
  --strict        warnings count as errors
  --architecture  print a "Who writes what" markdown section instead of findings`;

export async function run(argv: string[]): Promise<number> {
	const started = begin(argv, USAGE, false);
	if (typeof started === "number") return started;
	const { args, config } = started;
	if (args.architecture) {
		console.log(architectureSection(config));
		return 0;
	}
	const result = scanProject(config, args.strict);
	console.log(args.json ? jsonOutput(result) : humanOutput(result));
	if (result.files === 0) {
		// A brand-new repository has nothing to scan yet; that is a warning, not a failure.
		// Under --strict an empty include is an error, because in CI it usually means a wrong path.
		console.error(
			`theodolite.toml: warning: include matched no files (include = ${JSON.stringify(config.include)})`,
		);
		return args.strict ? 1 : 0;
	}
	return summarize(result).errors > 0 ? 1 : 0;
}
