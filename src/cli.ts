#!/usr/bin/env node
// theodolite: a map of who writes what in your codebase, enforced in CI.
// Commands: init, check, report, status. Each lives in its own module; this file only routes.

const USAGE = `theodolite <command> [options]

  init            write theodolite.toml, the CI workflow and .claude settings; add the rules to AGENTS.md
  check           scan against theodolite.toml (exit 1 on findings); --base <ref> scans only what changed
  report          print a proposed theodolite.toml from what the code does
  status          hook script: append a "needs you" line to STATUS.md when an agent asks a question

Run \`theodolite <command> --help\` for options.`;

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
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
