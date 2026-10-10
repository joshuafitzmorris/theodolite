// theodolite init: write the kit from templates/ into a repo. Never overwrites without --force.
// Settings and hook shapes follow https://code.claude.com/docs/en/settings (permissions)
// and https://code.claude.com/docs/en/hooks (hooks block).
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runReport } from "../scan/report.ts";

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");
const SETTINGS = ".claude/settings.json";

const USAGE = `theodolite init [--force] [--dry-run] [--root <dir>]

  --force       overwrite files that already exist (settings.json is always merged)
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

function listFiles(dir: string, base = ""): string[] {
	const out: string[] = [];
	for (const name of readdirSync(join(dir, base)).sort()) {
		const rel = base ? `${base}/${name}` : name;
		if (statSync(join(dir, rel)).isDirectory()) out.push(...listFiles(dir, rel));
		else out.push(rel);
	}
	return out;
}

export function render(text: string, vars: Record<string, string>): string {
	return text.replace(/\$\{(project|year)\}/g, (_, k: string) => vars[k] ?? "");
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
	const vars = { project: basename(opts.root), year: String(new Date().getFullYear()) };
	const write = (rel: string, content: string, mode?: number) => {
		if (opts.dryRun) return;
		const abs = join(opts.root, rel);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
		if (mode !== undefined) chmodSync(abs, mode);
	};

	for (const rel of listFiles(TEMPLATES)) {
		const tpl = readFileSync(join(TEMPLATES, rel), "utf8");
		const abs = join(opts.root, rel);
		const exists = existsSync(abs);
		const mode = statSync(join(TEMPLATES, rel)).mode & 0o111 ? 0o755 : undefined;

		if (rel === SETTINGS && exists) {
			let current: Json;
			try {
				current = asObject(JSON.parse(readFileSync(abs, "utf8")));
			} catch (e) {
				console.error(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
				return 1;
			}
			const { result, added, warnings } = mergeSettings(current, JSON.parse(tpl) as Json);
			for (const w of warnings) console.error(`warning: ${w}`);
			if (added.length === 0) {
				console.log(`skip (exists) ${rel}`);
				continue;
			}
			console.log(`merge ${rel}`);
			for (const a of added) console.log(`  added ${a}`);
			write(rel, `${JSON.stringify(result, null, 2)}\n`);
			continue;
		}
		if (exists && !opts.force) {
			console.log(`skip (exists) ${rel}`);
			continue;
		}
		let content = render(tpl, vars);
		if (rel === "theodolite.toml" && hasSourceFiles(opts.root)) {
			const proposed = await proposedConfig(opts.root);
			if (proposed) content = proposed;
		}
		console.log(`${exists ? "overwrite" : "create"} ${rel}`);
		write(rel, content, mode);
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
			writeFileSync(gi, `${giText ?? ""}${prefix}STATUS.md\n`);
		}
	}
	if (opts.dryRun) console.log("dry run: nothing written");
	return 0;
}
