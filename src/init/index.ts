// theodolite init: write theodolite.toml, the workflow, settings, subagents and a rules block into a repo.
// Never overwrites without --force, and never overwrites AGENTS.md or CLAUDE.md at all.
// Settings and hook shapes follow https://code.claude.com/docs/en/settings (permissions)
// and https://code.claude.com/docs/en/hooks (hooks block).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runReport } from "../scan/report.ts";
import { VERSION } from "../shared/version.ts";

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");
const SETTINGS = ".claude/settings.json";

const USAGE = `theodolite init [--force] [--dry-run] [--root <dir>]

  --force       overwrite theodolite.toml, the workflow and the subagent files
                (settings.json is always merged; AGENTS.md is only ever appended to)
  --dry-run     print what would happen, write nothing
  --root <dir>  target directory (default: current directory)`;

interface Options {
	force: boolean;
	dryRun: boolean;
	root: string;
}

function parseArgs(argv: string[]): Options | "help" | string {
	const o: Options = { force: false, dryRun: false, root: process.cwd() };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--force") o.force = true;
		else if (a === "--dry-run") o.dryRun = true;
		else if (a === "--root") {
			const v = argv[++i];
			if (!v) return "--root needs a directory";
			o.root = resolve(v);
		} else if (a === "-h" || a === "--help") return "help";
		else return `unknown option: ${a}`;
	}
	return o;
}

export function render(text: string, vars: Record<string, string>): string {
	return text.replace(/\$\{(project|version|check)\}/g, (_, k: string) => vars[k] ?? "");
}

const CHECK_SCRIPTS = ["check", "verify", "ci", "validate", "test"];
const DEFAULT_CHECK = "npm run check";

// The repo's own check command, or undefined when package.json names none of the usual scripts.
export function detectCheck(root: string): string | undefined {
	let scripts: Json;
	try {
		const pkg = asObject(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
		scripts = asObject(pkg.scripts);
	} catch {
		return undefined;
	}
	const name = CHECK_SCRIPTS.find((n) => typeof scripts[n] === "string");
	if (!name) return undefined;
	const has = (f: string) => existsSync(join(root, f));
	if (has("pnpm-lock.yaml")) return name === "test" ? "pnpm test" : `pnpm run ${name}`;
	if (has("yarn.lock")) return `yarn ${name}`;
	if (has("bun.lockb") || has("bun.lock")) return name === "test" ? "bun test" : `bun run ${name}`;
	return name === "test" ? "npm test" : `npm run ${name}`;
}

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|py)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "venv", "__pycache__"]);

function hasSourceFiles(dir: string, depth = 0): boolean {
	if (depth > 6) return false;
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return false;
	}
	for (const name of names) {
		const abs = join(dir, name);
		let isDir: boolean;
		try {
			isDir = statSync(abs).isDirectory();
		} catch {
			continue;
		}
		if (isDir) {
			if (!SKIP_DIRS.has(name) && hasSourceFiles(abs, depth + 1)) return true;
		} else if (SOURCE_EXT.test(name) && !name.endsWith(".d.ts")) return true;
	}
	return false;
}

// Run `theodolite report` for the target repo and return what it printed to stdout.
async function proposedConfig(root: string): Promise<string | undefined> {
	const original = console.log;
	let captured = "";
	console.log = (...args: unknown[]) => {
		captured += `${args.map(String).join(" ")}\n`;
	};
	let code: number;
	try {
		code = await runReport(["--root", root]);
	} catch {
		return undefined;
	} finally {
		console.log = original;
	}
	return code === 0 && captured.trim() ? captured : undefined;
}

type Json = Record<string, unknown>;

interface Merged {
	result: Json;
	added: string[];
	warnings: string[];
}

function asObject(v: unknown): Json {
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}

function handlerCommands(group: unknown): string[] {
	const hooks = asObject(group).hooks;
	if (!Array.isArray(hooks)) return [];
	return hooks.map((h) => asObject(h).command).filter((c): c is string => typeof c === "string");
}

// Add missing rules and hooks. Never remove or reorder anything the user has.
export function mergeSettings(existing: Json, wanted: Json): Merged {
	const result: Json = structuredClone(existing);
	const added: string[] = [];
	const warnings: string[] = [];

	const perms = asObject(result.permissions);
	const wantedPerms = asObject(wanted.permissions);
	for (const kind of ["deny", "ask", "allow"]) {
		const want = wantedPerms[kind];
		if (!Array.isArray(want)) continue;
		if (perms[kind] !== undefined && !Array.isArray(perms[kind])) {
			warnings.push(`permissions.${kind} is not an array; left untouched`);
			continue;
		}
		const have: unknown[] = Array.isArray(perms[kind]) ? (perms[kind] as unknown[]) : [];
		for (const rule of want) {
			if (!have.includes(rule)) {
				have.push(rule);
				added.push(`${kind} ${String(rule)}`);
			}
		}
		perms[kind] = have;
	}
	if (Object.keys(perms).length > 0) result.permissions = perms;

	const hooks = asObject(result.hooks);
	const wantedHooks = asObject(wanted.hooks);
	for (const [event, groups] of Object.entries(wantedHooks)) {
		if (!Array.isArray(groups)) continue;
		if (hooks[event] !== undefined && !Array.isArray(hooks[event])) {
			warnings.push(`hooks.${event} is not an array; left untouched`);
			continue;
		}
		const have: unknown[] = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
		const present = new Set(have.flatMap(handlerCommands));
		for (const g of groups) {
			const missing = handlerCommands(g).filter((c) => !present.has(c));
			if (missing.length > 0) {
				have.push(g);
				for (const c of missing) added.push(`hook ${event}: ${c}`);
			}
		}
		hooks[event] = have;
	}
	if (Object.keys(hooks).length > 0) result.hooks = hooks;
	return { result, added, warnings };
}

const RULES_HEADING = "## Rules for agents";
const AGENT_FILES = ["plan", "implement", "mechanical"].map((n) => `.claude/agents/${n}.md`);

export async function run(argv: string[]): Promise<number> {
	const opts = parseArgs(argv);
	if (opts === "help") {
		console.log(USAGE);
		return 0;
	}
	if (typeof opts === "string") {
		console.error(`${opts}\n\n${USAGE}`);
		return 2;
	}
	const detected = detectCheck(opts.root);
	const vars = { project: basename(opts.root), version: VERSION, check: detected ?? DEFAULT_CHECK };
	const template = (rel: string) => render(readFileSync(join(TEMPLATES, rel), "utf8"), vars);
	const write = (rel: string, content: string) => {
		if (opts.dryRun) return;
		const abs = join(opts.root, rel);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
	};

	// theodolite.toml, the workflow and the subagent files: create, or overwrite with --force.
	for (const rel of ["theodolite.toml", ".github/workflows/theodolite.yml", ...AGENT_FILES]) {
		const exists = existsSync(join(opts.root, rel));
		if (exists && !opts.force) {
			console.log(`skip (exists) ${rel}`);
			continue;
		}
		let content = template(rel);
		if (rel === "theodolite.toml" && hasSourceFiles(opts.root)) {
			const proposed = await proposedConfig(opts.root);
			// Source but nothing writes anything: no matrix to enforce. The door verdict still runs.
			if (proposed && !proposed.includes("[resources.")) {
				console.log(`skip ${rel} (report found no write sites; the door verdict still runs without it)`);
				continue;
			}
			if (proposed) content = proposed;
		}
		console.log(`${exists ? "overwrite" : "create"} ${rel}`);
		write(rel, content);
	}

	// settings.json: always merged, never replaced.
	const settingsAbs = join(opts.root, SETTINGS);
	if (existsSync(settingsAbs)) {
		let current: Json;
		try {
			current = asObject(JSON.parse(readFileSync(settingsAbs, "utf8")));
		} catch (e) {
			console.error(`${SETTINGS}: ${e instanceof Error ? e.message : String(e)}`);
			return 1;
		}
		const { result, added, warnings } = mergeSettings(current, JSON.parse(template(SETTINGS)) as Json);
		for (const w of warnings) console.error(`warning: ${w}`);
		if (added.length === 0) {
			console.log(`skip (exists) ${SETTINGS}`);
		} else {
			console.log(`merge ${SETTINGS}`);
			for (const a of added) console.log(`  added ${a}`);
			write(SETTINGS, `${JSON.stringify(result, null, 2)}\n`);
		}
	} else {
		console.log(`create ${SETTINGS}`);
		write(SETTINGS, template(SETTINGS));
	}

	// Rules block: appended to AGENTS.md, else CLAUDE.md, else both are created. Never overwritten.
	const block = template("rules.md");
	const hasFile = (f: string) => existsSync(join(opts.root, f));
	const target = hasFile("AGENTS.md") ? "AGENTS.md" : hasFile("CLAUDE.md") ? "CLAUDE.md" : undefined;
	if (target) {
		const text = readFileSync(join(opts.root, target), "utf8");
		if (text.split(/\r?\n/).some((l) => l === RULES_HEADING)) {
			console.log(`skip (exists) ${target}: ${RULES_HEADING}`);
		} else {
			console.log(`append ${target} (${RULES_HEADING})`);
			const lead = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n";
			write(target, `${text}${lead}${block}`);
		}
	} else {
		console.log("create AGENTS.md");
		write("AGENTS.md", `# ${vars.project}: rules for agents\n\n${block}`);
		console.log("create CLAUDE.md");
		write("CLAUDE.md", "@AGENTS.md\n");
	}

	// .gitignore: append STATUS.md, create if missing.
	const gi = join(opts.root, ".gitignore");
	const giText = existsSync(gi) ? readFileSync(gi, "utf8") : null;
	if (giText?.split(/\r?\n/).some((l) => l.trim() === "STATUS.md")) {
		console.log("skip (exists) .gitignore entry STATUS.md");
	} else {
		console.log(`${giText === null ? "create" : "append"} .gitignore (STATUS.md)`);
		if (!opts.dryRun) {
			const prefix = giText && !giText.endsWith("\n") ? "\n" : "";
			writeFileSync(join(opts.root, ".gitignore"), `${giText ?? ""}${prefix}STATUS.md\n`);
		}
	}
	if (opts.dryRun) console.log("dry run: nothing written");

	console.log("\nNext:");
	console.log(
		"  1. Commit these files on a branch and open a pull request. The workflow prints `doors: none` or the doors the PR opens.",
	);
	console.log(
		"  2. Review theodolite.toml: replace each TODO(tighten) path with a glob you trust. Agents cannot edit it.",
	);
	if (!detected) {
		console.log("  3. Rule 1 names `npm run check`; change it in AGENTS.md if your check command differs.");
	}
	return 0;
}
