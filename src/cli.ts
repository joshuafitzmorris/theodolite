#!/usr/bin/env node
// theodolite: a map of who writes what in your codebase, enforced in CI.
// Commands: init, check, report, status. Each lives in its own module; this file only routes.

const USAGE = `theodolite <command> [options]

  init            write theodolite.toml, AGENTS.md, hooks and CI into this repo
  check           scan the tree against theodolite.toml (exit 1 on findings)
  report          print a proposed theodolite.toml from what the code does
  status          hook script: append one plain-English line to STATUS.md

Run \`theodolite <command> --help\` for options.`;

const COMMAND_USAGE: Record<string, string> = {
	init: `theodolite init [--force] [--dry-run] [--root <dir>]

  --force       overwrite files that already exist (settings.json is always merged)
  --dry-run     print what would happen, write nothing
  --root <dir>  target directory (default: current directory)`,
	check: `theodolite check [--root <dir>] [--config <file>] [--json] [--strict] [--architecture]

  exit 0 clean or warnings only, 1 errors, 2 usage or config error
  --root <dir>     project directory (default: current directory)
  --config <file>  theodolite.toml to use (default: found walking up from --root)
  --json           print findings as JSON
  --strict         warnings count as errors
  --architecture   print a "Who writes what" markdown section instead of findings`,
	report: `theodolite report [--root <dir>] [--config <file>]

  --root <dir>     project directory (default: current directory)
  --config <file>  theodolite.toml whose [scan] and names to reuse
  prints a proposed theodolite.toml to stdout; writes nothing`,
	status: `theodolite status

  no options; reads the hook event on stdin and appends one line to STATUS.md`,
};

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
	if (command !== undefined && command in COMMAND_USAGE && rest.some((a) => a === "-h" || a === "--help")) {
		console.log(COMMAND_USAGE[command]);
		return 0;
	}
	switch (command) {
		case "init":
			return (await import("./init/index.ts")).run(rest);
		case "check":
			return (await import("./scan/check.ts")).run(rest);
		case "report":
			return (await import("./scan/report.ts")).run(rest);
		case "status":
			return (await import("./status/index.ts")).run(rest);
		case undefined:
		case "-h":
		case "--help":
			console.log(USAGE);
			return command === undefined ? 2 : 0;
		case "-v":
		case "--version":
			console.log((await import("./shared/version.ts")).VERSION);
			return 0;
		default:
			console.error(`unknown command: ${command}\n\n${USAGE}`);
			return 2;
	}
}

process.exitCode = await main(process.argv.slice(2));
