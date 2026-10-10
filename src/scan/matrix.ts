// theodolite.toml: parse, validate with line and column positions, and compile.

import { dirname, resolve } from "node:path";
import { minimatch } from "minimatch";
import { parseToml } from "../shared/toml.ts";
import type { Lang, Matcher } from "./tokens.ts";

export const KINDS = ["db", "external", "effect", "queue", "bucket", "fs", "custom"];
export type Unmapped = "ignore" | "warn" | "error";

export type Resource = {
	key: string;
	kind: string;
	name: string;
	writers: string[];
	constructors: string[] | null;
	/** Source text to find; empty on fs resources. */
	match: Matcher[];
	/** Path prefixes; fs resources only. */
	paths: string[];
	tables: string[];
	aliases: string[];
	line: number;
};

export type Config = {
	file: string;
	dir: string;
	include: string[];
	exclude: string[];
	languages: Lang[];
	unmapped: Unmapped;
	resources: Resource[];
	connections: { allow: string[]; match: Matcher[] } | null;
	grandfathered: { glob: string; resources: string[]; line: number }[];
};

export type ConfigError = { line: number; col: number; message: string };
export type Loaded = { ok: true; config: Config } | { ok: false; errors: ConfigError[] };

/** Always skipped; test files are skipped by `isTestFile` in walk.ts. */
export const DEFAULT_EXCLUDES = ["**/{node_modules,dist,build,.venv,__pycache__,migrations}/**", "**/*.d.ts"];

const globCache = new Map<string, RegExp | null>();

/** Compiled minimatch pattern, or null when the glob is invalid. */
export function globRe(glob: string): RegExp | null {
	if (!globCache.has(glob)) globCache.set(glob, minimatch.makeRe(glob, { dot: true }) || null);
	return globCache.get(glob) ?? null;
}

export const inGlobs = (path: string, globs: readonly string[]) => globs.some((g) => globRe(g)?.test(path));

/** Unquote, drop `schema.`, camelCase to snake_case, lowercase. */
export function snake(raw: string): string {
	const name = raw
		.trim()
		.replace(/["'`[\]]/g, "")
		.split(".")
		.pop();
	return (name ?? "")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
		.toLowerCase();
}

/**
 * Every spelling a snake_case name could have in the other number: `statuses` gives `status`, `movies` gives
 * `movie` and `movy`, `analyses` gives `analysis`. Two names are one table when their forms share a member.
 */
export function forms(raw: string): string[] {
	const s = snake(raw);
	const out = new Set([s]);
	if (s.endsWith("ies")) {
		out.add(`${s.slice(0, -3)}y`);
		out.add(s.slice(0, -1));
	}
	if (s.endsWith("es")) {
		const stem = s.slice(0, -2);
		if (/(?:s|x|z|ch|sh)$/.test(stem)) out.add(stem);
		out.add(`${stem}is`);
		out.add(s.slice(0, -1));
	}
	if (s.endsWith("s") && !/(?:ss|us|is)$/.test(s)) out.add(s.slice(0, -1));
	return [...out];
}

/** `snake` plus singular, so a plural table equals its singular model. */
export function norm(raw: string): string {
	const s = snake(raw);
	if (/ies$/.test(s)) return `${s.slice(0, -3)}y`;
	if (/(?:ss|us|is)$/.test(s)) return s;
	if (/(?:sses|xes|ches|shes)$/.test(s)) return s.slice(0, -2);
	return s.endsWith("s") ? s.slice(0, -1) : s;
}

export function parseMatcher(text: string): Matcher | string {
	const m = /^\/(.+)\/(i?)$/.exec(text);
	if (!m) return { text, re: null };
	try {
		return { text, re: new RegExp(m[1] ?? "", `g${m[2]}`) };
	} catch (err) {
		return `invalid regex ${text} (${err instanceof Error ? err.message : String(err)})`;
	}
}

const KNOWN = {
	scan: ["include", "exclude", "languages", "unmapped"],
	resource: ["writers", "constructors", "match", "paths", "tables", "aliases"],
	connections: ["allow", "match"],
	top: ["scan", "resources", "connections", "grandfathered"],
};

const distance = (a: string, b: string): number => {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			const sub = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
			row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, sub));
		}
		prev = row;
	}
	return prev[b.length] ?? 0;
};

const suggest = (key: string, known: string[]) => {
	const best = known.find((k) => distance(key, k) <= 2 || k.startsWith(key) || key.startsWith(k));
	return best ? ` (did you mean "${best}"?)` : "";
};

function splitDotted(s: string): string[] {
	const out: string[] = [];
	const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([\w-]+))\s*(?:\.|$)/y;
	for (let m = re.exec(s); m && m[0] !== ""; m = re.exec(s)) {
		out.push(m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : (m[2] ?? m[3] ?? ""));
	}
	return out;
}

type Pos = { line: number; col: number };

/** Line and column of every table header and key, by dotted path joined with NUL. */
function indexPositions(text: string): Map<string, Pos> {
	const pos = new Map<string, Pos>();
	let table: string[] = [];
	text.split(/\r?\n/).forEach((row, i) => {
		const header = /^\s*\[\[?\s*(.+?)\s*\]\]?\s*(?:#.*)?$/.exec(row);
		const key = header ? null : /^\s*("(?:[^"\\]|\\.)*"|'[^']*'|[\w-]+)\s*=/.exec(row);
		if (header) table = splitDotted(header[1] ?? "");
		if (!header && !key) return;
		const raw = key ? (key[1] ?? "") : "[";
		const name = raw.startsWith('"') ? String(JSON.parse(raw)) : raw.replace(/^'|'$/g, "");
		pos.set((key ? [...table, name] : table).join("\0"), { line: i + 1, col: row.indexOf(raw) + 1 });
	});
	return pos;
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

export function emptyConfig(dir: string): Config {
	const loaded = loadConfig("", resolve(dir, "theodolite.toml"));
	if (!loaded.ok) throw new Error("an empty config is always valid");
	return loaded.config;
}

export function loadConfig(text: string, file: string): Loaded {
	let doc: Record<string, unknown>;
	try {
		doc = parseToml(text);
	} catch (err) {
		const e: { line?: unknown; column?: unknown; message?: unknown } =
			typeof err === "object" && err !== null ? err : {};
		const first = String(e.message ?? err).split("\n")[0] ?? "";
		return {
			ok: false,
			errors: [
				{
					line: typeof e.line === "number" ? e.line : 1,
					col: typeof e.column === "number" ? e.column : 1,
					message: first,
				},
			],
		};
	}
	const pos = indexPositions(text);
	const errors: ConfigError[] = [];
	const at = (path: string[]): Pos => {
		for (let p = path; p.length > 0; p = p.slice(0, -1)) {
			const hit = pos.get(p.join("\0"));
			if (hit) return hit;
		}
		return { line: 1, col: 1 };
	};
	const fail = (path: string[], message: string) => errors.push({ ...at(path), message });

	const strings = (path: string[], value: unknown, what: string, fallback: string[] = []): string[] => {
		if (value === undefined) return fallback;
		if (!isStrings(value)) {
			fail(path, `${what} must be an array of strings`);
			return [];
		}
		if (value.some((x) => x.trim() === "")) fail(path, `${what} has an empty string`);
		return value;
	};
	const globs = (path: string[], value: unknown, what: string, fallback: string[] = []) => {
		const list = strings(path, value, what, fallback);
		for (const g of list.filter((x) => x !== "")) {
			if (g.startsWith("!")) fail(path, `${what}: "!" globs are not supported (${JSON.stringify(g)})`);
			else if (!globRe(g)) fail(path, `${what}: invalid glob ${JSON.stringify(g)}`);
		}
		return list;
	};
	const known = (path: string[], obj: Record<string, unknown>, names: string[], label: string) => {
		for (const k of Object.keys(obj).filter((x) => !names.includes(x))) {
			fail([...path, k], `unknown ${path.length ? "key" : "table"} "${k}"${label}${suggest(k, names)}`);
		}
	};
	const matchers = (path: string[], value: unknown): Matcher[] => {
		const out: Matcher[] = [];
		for (const x of strings(path, value, "match").filter((y) => y !== "")) {
			const m = parseMatcher(x);
			if (typeof m === "string") fail(path, m);
			else out.push(m);
		}
		return out;
	};

	if (doc.imports !== undefined) fail(["imports"], "[imports] is not supported in this version");
	known([], Object.fromEntries(Object.entries(doc).filter(([k]) => k !== "imports")), KNOWN.top, "");
	const scan = isObj(doc.scan) ? doc.scan : {};
	known(["scan"], scan, KNOWN.scan, " in [scan]");
	const languages = strings(["scan", "languages"], scan.languages, "languages", ["ts", "py"]);
	for (const l of languages.filter((x) => x !== "ts" && x !== "py"))
		fail(["scan", "languages"], `unknown language "${l}" (use "ts" or "py")`);
	const level = scan.unmapped ?? "warn";
	const unmapped: Unmapped | null =
		level === "ignore" || level === "warn" || level === "error" ? level : null;
	if (unmapped === null) fail(["scan", "unmapped"], `unmapped must be "ignore", "warn" or "error"`);

	const resources: Resource[] = [];
	const claimed = new Map<string, string>();
	for (const [key, body] of Object.entries(isObj(doc.resources) ? doc.resources : {})) {
		const head = ["resources", key];
		const label = `[resources."${key}"]`;
		const m = new RegExp(`^(${KINDS.join("|")})\\.(\\S+)$`).exec(key);
		if (!m || !isObj(body)) {
			fail(
				head,
				m
					? `${label} must be a table`
					: `bad resource key ${JSON.stringify(key)}: use <kind>.<name>, kind one of ${KINDS.join("|")}`,
			);
			continue;
		}
		const kind = m[1] ?? "";
		const name = m[2] ?? "";
		known(head, body, KNOWN.resource, ` in ${label}`);
		if (!("writers" in body)) fail(head, `missing "writers" in ${label} (use [] for write-never)`);
		const required = kind === "fs" ? "paths" : "match";
		if (kind === "fs" && "match" in body)
			fail([...head, "match"], `"match" on fs resources was renamed to "paths" (${label}); rename the key`);
		else if (kind !== "db" && !(required in body)) fail(head, `missing "${required}" in ${label}`);
		if (kind !== "fs" && "paths" in body)
			fail([...head, "paths"], `"paths" is only allowed on fs resources (${label})`);
		for (const k of ["tables", "aliases"].filter((x) => kind !== "db" && x in body))
			fail([...head, k], `"${k}" is only allowed on db resources (${label})`);
		const tables = strings([...head, "tables"], body.tables, "tables");
		const aliases = strings([...head, "aliases"], body.aliases, "aliases");
		if (kind === "db") {
			const ids: [string[], string[], string][] = [
				[head, forms(name), norm(name)],
				...tables.map((x): [string[], string[], string] => [[...head, "tables"], forms(x), norm(x)]),
				...aliases.map((x): [string[], string[], string] => [[...head, "aliases"], [x], x]),
			];
			for (const [path, spellings, id] of ids) {
				const owner = spellings.map((f) => claimed.get(f)).find((o) => o !== undefined && o !== key);
				if (owner) fail(path, `"${id}" is already claimed by [resources."${owner}"]`);
				else for (const f of spellings) claimed.set(f, key);
			}
		}
		resources.push({
			key,
			kind,
			name,
			writers: globs([...head, "writers"], body.writers, "writers"),
			constructors:
				"constructors" in body ? globs([...head, "constructors"], body.constructors, "constructors") : null,
			match: kind === "fs" ? [] : matchers([...head, "match"], body.match),
			paths: kind === "fs" ? strings([...head, "paths"], body.paths, "paths") : [],
			tables,
			aliases,
			line: at(head).line,
		});
	}

	let connections: Config["connections"] = null;
	if (doc.connections !== undefined) {
		const c = isObj(doc.connections) ? doc.connections : {};
		known(["connections"], c, KNOWN.connections, " in [connections]");
		connections = {
			allow: globs(["connections", "allow"], c.allow, "allow"),
			match: matchers(["connections", "match"], c.match),
		};
	}
	const grandfathered: Config["grandfathered"] = Object.entries(
		isObj(doc.grandfathered) ? doc.grandfathered : {},
	).map(([glob, list]) => {
		const path = ["grandfathered", glob];
		globs(path, [glob], "[grandfathered] key");
		const names = strings(path, list, "resources");
		for (const r of names.filter((x) => !resources.some((y) => y.key === x)))
			fail(path, `unknown resource ${JSON.stringify(r)} in [grandfathered]`);
		return { glob, resources: names, line: at(path).line };
	});

	const include = globs(["scan", "include"], scan.include, "include", ["**"]);
	const exclude = globs(["scan", "exclude"], scan.exclude, "exclude");
	if (errors.length > 0)
		return { ok: false, errors: errors.sort((a, b) => a.line - b.line || a.col - b.col) };
	const config = {
		file,
		dir: dirname(file),
		include,
		exclude,
		languages: languages.filter((l): l is Lang => l === "ts" || l === "py"),
		unmapped: unmapped ?? "warn",
		resources,
		connections,
		grandfathered,
	};
	return { ok: true, config };
}
