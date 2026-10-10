// The text `theodolite report` prints. With a config on disk, every line of it is carried through and only
// newly discovered writers are appended; with none, a full matrix is written from what the code does.

import type { Config, Resource } from "./matrix.ts";
import { forms, globRe, inGlobs } from "./matrix.ts";
import type { ResolveResult } from "./resolve.ts";

type Entry = { path: string; sites: number };
type Group = {
	writers: Map<string, number>;
	constructors: Map<string, number>;
	match: Set<string>;
	/** True when the resource is not in the config. */
	added: boolean;
};

const q = JSON.stringify;
const arr = (xs: string[]) => `[${xs.map((x) => q(x)).join(", ")}]`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const sorted = (m: Map<string, number>): Entry[] =>
	[...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, sites]) => ({ path, sites }));

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Index of the `]` that closes the array opened at `open`, and the last significant character before it. */
function arrayEnd(text: string, open: number): { close: number; last: number } | null {
	let depth = 0;
	let last = open;
	for (let i = open; i < text.length; i++) {
		const c = text[i];
		if (c === "#") {
			const nl = text.indexOf("\n", i);
			if (nl < 0) return null;
			i = nl;
		} else if (c === '"' || c === "'") {
			let j = i + 1;
			while (j < text.length && text[j] !== c && text[j] !== "\n") j += c === '"' && text[j] === "\\" ? 2 : 1;
			i = j;
			last = j;
		} else if (c === "[") {
			depth++;
			last = i;
		} else if (c === "]") {
			if (--depth === 0) return { close: i, last };
			last = i;
		} else if (c !== undefined && c.trim() !== "") last = i;
	}
	return null;
}

/** Top-level elements of a one-line array body, as written. */
function elementsOf(body: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (c === '"' || c === "'") {
			const end = body.indexOf(c, i + 1);
			i = end < 0 ? body.length : end;
		} else if (c === "[" || c === "{") depth++;
		else if (c === "]" || c === "}") depth--;
		else if (c === "," && depth === 0) {
			out.push(body.slice(from, i).trim());
			from = i + 1;
		}
	}
	out.push(body.slice(from).trim());
	return out.filter((x) => x !== "");
}

/**
 * Append entries to `key = [...]` inside the table whose header matches `header`, leaving every other
 * byte alone. A one-line array becomes a multi-line one with its entries as written. Returns null when
 * the table or the key cannot be found.
 */
export function appendToArray(text: string, header: RegExp, key: string, entries: Entry[]): string | null {
	if (entries.length === 0) return text;
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split("\n");
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}
	const h = lines.findIndex((l) => header.test(l.replace(/\r$/, "")));
	if (h < 0) return null;
	let end = lines.findIndex((l, i) => i > h && /^[ \t]*\[/.test(l));
	if (end < 0) end = lines.length;
	const keyRe = new RegExp(`^[ \\t]*(?:${escapeRe(key)}|"${escapeRe(key)}"|'${escapeRe(key)}')[ \\t]*=`);
	const k = lines.findIndex((l, i) => i > h && i < end && keyRe.test(l));
	if (k < 0) return null;
	const open = text.indexOf("[", (starts[k] ?? 0) + (lines[k]?.indexOf("=") ?? 0));
	const span = arrayEnd(text, open);
	if (open < 0 || !span) return null;

	const width = Math.max(...entries.map((e) => q(e.path).length)) + 1;
	const note = (e: Entry) =>
		`${`${q(e.path)},`.padEnd(width + 1)} # TODO(tighten) ${plural(e.sites, "site")}`;
	const lineStart = text.lastIndexOf("\n", open) + 1;
	const closeLine = text.lastIndexOf("\n", span.close) + 1;
	const oneLine = closeLine <= lineStart;
	if (oneLine) {
		const eolAt = text.indexOf("\n", span.close);
		const lineEnd = eolAt < 0 ? text.length : eolAt;
		const kept = elementsOf(text.slice(open + 1, span.close)).map((x) => `  ${x},`);
		const body = [...kept, ...entries.map((e) => `  ${note(e)}`)].join(eol);
		return `${text.slice(0, open + 1)}${eol}${body}${eol}]${text.slice(span.close + 1, lineEnd)}${text.slice(lineEnd)}`;
	}
	const inside = text.slice(open, closeLine);
	const indent = /\n([ \t]+)["']/.exec(inside)?.[1] ?? "  ";
	const comma = text[span.last] === "," || span.last === open ? "" : ",";
	const added = entries.map((e) => `${indent}${note(e)}`).join(eol);
	const alone = text.slice(closeLine, span.close).trim() === "";
	const head = text.slice(0, span.last + 1);
	const between = text.slice(span.last + 1, alone ? closeLine : span.close);
	const tail = alone ? text.slice(closeLine) : text.slice(span.close);
	return `${head}${comma}${between}${alone ? "" : eol}${added}${eol}${tail}`;
}

const tableHeader = (path: string) => new RegExp(`^[ \\t]*\\[[ \\t]*${path}[ \\t]*\\][ \\t]*(?:#.*)?$`);
const resourceHeader = (key: string) =>
	tableHeader(`resources[ \\t]*\\.[ \\t]*(?:"${escapeRe(key)}"|'${escapeRe(key)}')`);

/** Where a site's file must be listed for `check` to accept it; null when it already is. */
function missingList(
	cfg: Config,
	r: Resource,
	file: string,
	construct: boolean,
): "writers" | "constructors" | null {
	const inCons = r.constructors !== null && inGlobs(file, r.constructors);
	const constructing = r.constructors !== null && construct;
	if (constructing ? inCons : inGlobs(file, r.writers) || inCons) return null;
	if (cfg.grandfathered.some((g) => g.resources.includes(r.key) && globRe(g.glob)?.test(file))) return null;
	return constructing ? "constructors" : "writers";
}

export function proposeToml(cfg: Config, res: ResolveResult, existing: string | null): string {
	const byKey = new Map(cfg.resources.map((r) => [r.key, r]));
	const groups = new Map<string, Group>();
	const dbNames = new Map<string, string>();
	const claim = (name: string, key: string) => {
		for (const f of forms(name)) if (!dbNames.has(f)) dbNames.set(f, key);
	};
	const canonical = (name: string) =>
		forms(name)
			.map((f) => dbNames.get(f))
			.find((k) => k !== undefined);
	for (const r of cfg.resources) if (r.kind === "db") for (const n of [r.name, ...r.tables]) claim(n, r.key);
	const unmapped: string[] = [];
	for (const s of res.sites) {
		let key = s.resources[0];
		let match: string | null = null;
		if (key === undefined) {
			const p = s.proposed;
			if (!p) {
				unmapped.push(`# ${s.file}:${s.site.line}  ${s.site.via}`);
				continue;
			}
			match = p.match;
			key = p.key;
			if (key.startsWith("db.")) {
				const known = canonical(key);
				if (known) key = known;
				else claim(key, key);
			}
		}
		const g = groups.get(key) ?? {
			writers: new Map(),
			constructors: new Map(),
			match: new Set(),
			added: !byKey.has(key),
		};
		groups.set(key, g);
		const r = byKey.get(key);
		const construct = s.site.construction || s.site.kind === "new";
		const isNew = s.site.kind === "new";
		const list = !r
			? isNew
				? null
				: "writers"
			: isNew && r.constructors === null
				? null
				: missingList(cfg, r, s.file, construct);
		if (list) g[list].set(s.file, (g[list].get(s.file) ?? 0) + 1);
		if (match) g.match.add(match);
	}

	let text = existing?.trim() ? withoutGenerated(existing) : header(cfg);
	const pending: string[] = [];
	const patch = (headerRe: RegExp, key: string, entries: Entry[], label: string) => {
		const next = appendToArray(text, headerRe, key, entries);
		if (next === null) pending.push(`# add to ${label}: ${arr(entries.map((e) => e.path))}`);
		else text = next;
	};
	for (const [key, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
		if (g.added) continue;
		patch(resourceHeader(key), "writers", sorted(g.writers), `[resources.${q(key)}] writers`);
		patch(resourceHeader(key), "constructors", sorted(g.constructors), `[resources.${q(key)}] constructors`);
	}
	if (cfg.connections) {
		const allow = cfg.connections.allow;
		const files = [...new Set(res.connections.map((c) => c.file))].filter((f) => !inGlobs(f, allow)).sort();
		patch(
			tableHeader("connections"),
			"allow",
			files.map((path) => ({ path, sites: 1 })),
			"[connections] allow",
		);
	}

	const parts = [text.replace(/\n+$/, "")];
	for (const [key, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
		if (g.added) parts.push(block(key, g).join("\n"));
	}
	if (pending.length > 0) parts.push(["# not applied", ...pending].join("\n"));
	if (unmapped.length > 0) parts.push(["# unmapped", ...unmapped].join("\n"));
	const result = `${parts.join("\n\n")}\n`;
	return existing?.includes("\r\n") ? result.replace(/\r?\n/g, "\r\n") : result;
}

/** Drops the trailing `# unmapped` or `# not applied` comment block an earlier report appended. */
function withoutGenerated(text: string): string {
	const lines = text.split("\n");
	const at = lines.findIndex(
		(l, i) =>
			/^# (?:unmapped|not applied)\s*$/.test(l) && lines.slice(i).every((x) => /^\s*(?:#.*)?$/.test(x)),
	);
	return at < 0 ? text : lines.slice(0, at).join("\n").replace(/\s*$/, "\n");
}

/** A resource that is not in the config yet, every writing file by exact path. */
function block(key: string, g: Group): string[] {
	const out = [`[resources.${q(key)}]`];
	if (g.match.size > 0) out.push(`${key.startsWith("fs.") ? "paths" : "match"} = ${arr([...g.match])}`);
	const files = sorted(g.writers);
	if (files.length === 0) return [...out, "writers = []"];
	const width = Math.max(...files.map((f) => q(f.path).length)) + 1;
	out.push("writers = [");
	for (const f of files)
		out.push(`  ${`${q(f.path)},`.padEnd(width + 1)} # TODO(tighten) ${plural(f.sites, "site")}`);
	return [...out, "]"];
}

function header(cfg: Config): string {
	const out = [
		"# Proposed by `theodolite report`. Replace each TODO(tighten) path with a glob you trust.",
		"",
		"[scan]",
		`include = ${arr(cfg.include)}`,
	];
	if (cfg.exclude.length > 0) out.push(`exclude = ${arr(cfg.exclude)}`);
	out.push(`languages = ${arr(cfg.languages)}`);
	if (cfg.unmapped !== "warn") out.push(`unmapped = ${q(cfg.unmapped)}`);
	return out.join("\n");
}
