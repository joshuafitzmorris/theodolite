// The text `theodolite report` prints. With no config, a full matrix from what the code does, every writing
// file by exact path. With a config, the file as it is plus a [grandfathered] entry for each undeclared
// write: the matrix only ever grows there, where `check` counts it and flags stale pairs. A resource with
// writers = [] is never touched, and nothing else in the file is edited.

import type { Config } from "./matrix.ts";
import { forms } from "./matrix.ts";
import type { ResolveResult } from "./resolve.ts";

type Group = { writers: Map<string, number>; match: Set<string> };

const q = JSON.stringify;
const arr = (xs: string[]) => `[${xs.map((x) => q(x)).join(", ")}]`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const byName = ([a]: [string, unknown], [b]: [string, unknown]) => (a < b ? -1 : 1);

export function proposeToml(cfg: Config, res: ResolveResult, existing: string | null): string {
	const text = existing?.trim() ? amend(res, existing.replace(/\r\n/g, "\n")) : fresh(cfg, res);
	return existing?.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

const unmappedLines = (res: ResolveResult) =>
	res.sites.filter((s) => s.state !== "resolved").map((s) => `# ${s.file}:${s.site.line}  ${s.site.via}`);

/** A full matrix for a repository with no config. */
function fresh(cfg: Config, res: ResolveResult): string {
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
		const g = groups.get(key) ?? { writers: new Map(), match: new Set() };
		groups.set(key, g);
		if (s.site.kind !== "new") g.writers.set(s.file, (g.writers.get(s.file) ?? 0) + 1);
		if (match) g.match.add(match);
	}
	const parts = [header(cfg)];
	for (const [key, g] of [...groups].sort(byName)) parts.push(block(key, g).join("\n"));
	if (unmapped.length > 0) parts.push(["# unmapped", ...unmapped].join("\n"));
	return `${parts.join("\n\n")}\n`;
}

/** The existing config with undeclared writes added to [grandfathered] and stale pairs removed. */
function amend(res: ResolveResult, existing: string): string {
	const add = new Map<string, Set<string>>();
	const stale = new Map<string, Set<string>>();
	const notes: string[] = [];
	const into = (m: Map<string, Set<string>>, key: string, value: string) => {
		const set = m.get(key) ?? new Set<string>();
		set.add(value);
		m.set(key, set);
	};
	for (const f of res.findings) {
		if (!f.resource) continue;
		if (f.rule === "undeclared-write" || f.rule === "undeclared-constructor") into(add, f.file, f.resource);
		else if (f.rule === "stale-grandfathered") into(stale, f.target, f.resource);
		else if (f.rule === "write-never")
			notes.push(`# ${f.file}:${f.line}  writes ${f.resource} (${f.via})  write-never`);
	}
	const parts = [mergeGrandfathered(withoutGenerated(existing), add, stale).replace(/\n+$/, "")];
	if (notes.length > 0) parts.push(["# not grandfathered", ...notes].join("\n"));
	const unmapped = unmappedLines(res);
	if (unmapped.length > 0) parts.push(["# unmapped", ...unmapped].join("\n"));
	return `${parts.join("\n\n")}\n`;
}

const HEADER = /^\s*\[/;
const GRANDFATHERED = /^\s*\[grandfathered\]\s*(?:#.*)?$/;
const ENTRY = /^(\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s=#'"]+)\s*=\s*\[([^\]]*)\]\s*(#.*)?$/;

const unquote = (x: string): string =>
	x.startsWith('"') ? String(JSON.parse(x)) : x.startsWith("'") ? x.slice(1, -1) : x;

/**
 * Add `file = [resources]` lines to the [grandfathered] table and drop stale pairs. An entry that exists is
 * rewritten on its own line, with its comment kept; every other byte of the file stays as it was.
 */
export function mergeGrandfathered(
	text: string,
	add: Map<string, Set<string>>,
	stale: Map<string, Set<string>>,
): string {
	const lines = text.split("\n");
	const h = lines.findIndex((l) => GRANDFATHERED.test(l));
	const pending = new Map(add);
	const entryLine = (indent: string, key: string, items: string[], comment: string | undefined) =>
		`${indent}${q(key)} = ${arr(items)}${comment ? `  ${comment}` : ""}`;
	if (h >= 0) {
		let end = lines.findIndex((l, i) => i > h && HEADER.test(l));
		if (end < 0) end = lines.length;
		let last = h;
		const dropped = new Set<number>();
		for (let i = h + 1; i < end; i++) {
			const line = lines[i] ?? "";
			if (line.trim() !== "" && !line.trim().startsWith("#")) last = i;
			const m = ENTRY.exec(line);
			if (!m) continue;
			const key = unquote(m[2] ?? "");
			const items = (m[3] ?? "")
				.split(",")
				.map((x) => x.trim())
				.filter((x) => x !== "")
				.map(unquote);
			const kept = new Set(items.filter((r) => !stale.get(key)?.has(r)));
			for (const r of pending.get(key) ?? []) kept.add(r);
			pending.delete(key);
			if (kept.size === items.length && items.every((r) => kept.has(r))) continue;
			if (kept.size === 0) dropped.add(i);
			else lines[i] = entryLine(m[1] ?? "", key, [...kept].sort(), m[4]);
		}
		const fresh = [...pending]
			.sort(byName)
			.map(([file, set]) => entryLine("", file, [...set].sort(), undefined));
		const out = lines.filter((_, i) => !dropped.has(i));
		out.splice(last + 1 - [...dropped].filter((i) => i <= last).length, 0, ...fresh);
		return out.join("\n");
	}
	if (pending.size === 0) return text;
	const fresh = [...pending]
		.sort(byName)
		.map(([file, set]) => entryLine("", file, [...set].sort(), undefined));
	const body = text.replace(/\n*$/, "\n");
	return `${body}\n[grandfathered]\n${fresh.join("\n")}\n`;
}

/** Drops a trailing comment block an earlier report appended. */
function withoutGenerated(text: string): string {
	const lines = text.split("\n");
	const at = lines.findIndex(
		(l, i) =>
			/^# (?:unmapped|not grandfathered|not applied)\s*$/.test(l) &&
			lines.slice(i).every((x) => /^\s*(?:#.*)?$/.test(x)),
	);
	return at < 0 ? text : lines.slice(0, at).join("\n").replace(/\s*$/, "\n");
}

/** A resource that is not in the config yet, every writing file by exact path. */
function block(key: string, g: Group): string[] {
	const out = [`[resources.${q(key)}]`];
	if (g.match.size > 0) out.push(`${key.startsWith("fs.") ? "paths" : "match"} = ${arr([...g.match])}`);
	const files = [...g.writers].sort(byName).map(([path, sites]) => ({ path, sites }));
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
