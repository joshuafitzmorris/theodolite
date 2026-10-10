// Turn found sites into resources, then judge each one against the matrix.

import { basename } from "node:path";
import type { FileFacts, FoundSite } from "./detect.ts";
import { type Config, forms, globRe, inGlobs, type Resource, snake } from "./matrix.ts";
import { sdkFor } from "./sdk.ts";
import { matchOffsets } from "./shared.ts";

export type Rule =
	| "undeclared-write"
	| "write-never"
	| "unresolved-target"
	| "unmapped-write"
	| "undeclared-constructor"
	| "undeclared-connection"
	| "grandfathered"
	| "stale-grandfathered"
	| "grandfathered-grew"
	| "test-skipped";

export type Severity = "error" | "warning" | "note";

export interface Finding {
	rule: Rule;
	severity: Severity;
	file: string;
	line: number;
	col: number;
	resource: string | null;
	target: string;
	via: string;
	family: string;
	confidence: string;
	fix: { key: string; add: string } | null;
	/** Human text after `file:line  `. */
	message: string;
}

export interface Resolved {
	file: string;
	site: FoundSite;
	state: "resolved" | "unresolved" | "unmapped";
	resources: string[];
	/** For unmapped sites: the resource and match entry a new declaration would use. */
	proposed: { key: string; match: string | null } | null;
}

export interface ResolveResult {
	findings: Finding[];
	sites: Resolved[];
	files: number;
	writeSites: number;
	connections: { file: string; line: number; via: string }[];
}

/** The resource a new declaration would use for a site no resource claims. */
export function propose(s: FoundSite): Resolved["proposed"] {
	if (s.kind === "db")
		return s.dynamic || !snake(s.target) ? null : { key: `db.${snake(s.target)}`, match: null };
	if (s.kind === "http") {
		const sdk = sdkFor(s.target);
		if (sdk) return { key: `external.${sdk.name}`, match: sdk.ctor };
		const host = /^["'`]?https?:\/\/([^/:?#"'`\s${}]+)/.exec(s.target)?.[1];
		return host ? { key: `external.${host}`, match: host } : null;
	}
	if (s.kind === "fs" && !s.dynamic) {
		const parts = s.target.replace(/^\.?\/+/, "").split("/");
		const first = parts[0] ?? "";
		if (first === "" || first === "..") return null;
		return { key: `fs.${first.replace(/\W+/g, "_")}`, match: parts.length > 1 ? `${first}/` : first };
	}
	return null;
}

function matchesText(r: Resource, text: string): boolean {
	return r.match.some((m) => matchOffsets(m, text).length > 0);
}

type At = { line: number; col: number; target?: string; via?: string; family?: string; confidence?: string };

const F = (
	rule: Rule,
	severity: Severity,
	file: string,
	at: At,
	resource: string | null,
	fix: Finding["fix"],
	message: string,
): Finding => ({
	rule,
	severity,
	file,
	line: at.line,
	col: at.col,
	resource,
	target: at.target ?? "",
	via: at.via ?? "",
	family: at.family ?? rule,
	confidence: at.confidence ?? "high",
	fix,
	message,
});

/** The globs that may write a resource, for the finding that names the owner. */
export function ownerOf(r: Resource): string {
	const globs = r.writers.length > 0 ? r.writers : (r.constructors ?? []);
	return globs.length > 0 ? globs.join(", ") : "nothing";
}

export function resolveAll(
	cfg: Config,
	scanned: { path: string; facts: FileFacts }[],
	fileCount: number,
	strict: boolean,
	checkStale = true,
): ResolveResult {
	const byKey = new Map(cfg.resources.map((r) => [r.key, r]));
	const dbByName = new Map<string, Resource>();
	const aliasOf = new Map<string, Resource>();
	for (const r of cfg.resources.filter((x) => x.kind === "db")) {
		for (const n of [r.name, ...r.tables]) for (const f of forms(n)) if (!dbByName.has(f)) dbByName.set(f, r);
		for (const a of r.aliases) aliasOf.set(a, r);
	}
	const matchable = cfg.resources.filter((r) => r.kind !== "fs" && r.match.length > 0);
	const fsRes = cfg.resources.filter((r) => r.kind === "fs");
	const findings: Finding[] = [];
	const sites: Resolved[] = [];
	const connections: ResolveResult["connections"] = [];
	const usedGf = new Set<string>();
	const seen = new Set<string>();
	let writeSites = 0;
	const soft = (): Severity => (strict ? "error" : "warning");
	const unmappedSeverity = (): Severity => (cfg.unmapped === "error" ? "error" : soft());
	const strip = (x: string) => x.replace(/^\.?\//, "");

	const tableOf = (name: string) =>
		forms(name)
			.map((f) => dbByName.get(f))
			.find((r) => r !== undefined);
	const targets = (s: FoundSite): Resource[] => {
		const found = new Set<Resource | undefined>();
		if (s.kind === "match") found.add(byKey.get(s.resource));
		else if (s.kind === "new") found.add(aliasOf.get(s.target));
		else if (s.kind === "db") {
			if (!s.dynamic && s.confidence !== "low") found.add(tableOf(s.target));
			found.add(aliasOf.get(s.target) ?? aliasOf.get(s.receiver));
		} else if (s.kind === "http") {
			for (const r of matchable) if (matchesText(r, s.target) || matchesText(r, s.receiver)) found.add(r);
		} else {
			for (const r of fsRes) if (r.paths.some((p) => strip(s.target).startsWith(strip(p)))) found.add(r);
		}
		return [...found].filter((r): r is Resource => r !== undefined);
	};
	const dynamicKind: Record<string, string> = { fs: "fs", db: "db", http: "external" };
	/** First resource of the site's kind whose writers, constructors or grandfathered globs cover the file. */
	const listedFor = (file: string, s: FoundSite): Resource[] => {
		const kind = dynamicKind[s.kind];
		const hit = cfg.resources.find(
			(r) =>
				r.kind === kind &&
				(inGlobs(file, r.writers) ||
					(r.constructors !== null && inGlobs(file, r.constructors)) ||
					cfg.grandfathered.some((g) => g.resources.includes(r.key) && globRe(g.glob)?.test(file))),
		);
		return hit ? [hit] : [];
	};

	const judge = (file: string, s: FoundSite, r: Resource) => {
		const isNew = s.kind === "new";
		const inCons = r.constructors !== null && inGlobs(file, r.constructors);
		const constructing = r.constructors !== null && (s.construction || isNew);
		if (constructing ? inCons : isNew || inGlobs(file, r.writers) || inCons) return;
		const gf = cfg.grandfathered.filter((g) => g.resources.includes(r.key) && globRe(g.glob)?.test(file));
		const say = (verb: string, tail: string) => `${verb} ${r.key} (${s.via})  ${tail}`;
		const add = (rule: Rule, sev: Severity, fix: Finding["fix"], msg: string) =>
			findings.push(F(rule, sev, file, s, r.key, fix, msg));
		if (gf.length > 0) {
			for (const g of gf) usedGf.add(`${g.glob}|${r.key}`);
			add("grandfathered", "note", null, say("writes", "grandfathered, TODO(tighten)"));
		} else if (constructing) {
			const owner = (r.constructors ?? []).join(", ") || "nothing";
			add(
				"undeclared-constructor",
				"error",
				{ key: "constructors", add: file },
				say(
					isNew ? "constructs" : "creates",
					`${r.key} is created by ${owner}; call it from there, or say in the PR why this file must create it.`,
				),
			);
		} else if (r.writers.length === 0 && !r.constructors?.length) {
			add(
				"write-never",
				"error",
				null,
				say("writes", `write-never: nothing may write ${r.key}. Say in the PR why that must change.`),
			);
		} else {
			add(
				"undeclared-write",
				"error",
				{ key: "writers", add: file },
				say(
					"writes",
					`${r.key} is written by ${ownerOf(r)}; call it from there, or say in the PR why this file must write it.`,
				),
			);
		}
	};

	const unmapped = (file: string, s: FoundSite, prop: Resolved["proposed"]) => {
		if (cfg.unmapped === "ignore") return;
		const sev = unmappedSeverity();
		const tag = sev === "error" ? "" : " (warning)";
		if (s.dynamic) {
			const field = s.kind === "db" ? "aliases" : s.kind === "fs" ? "paths" : "match";
			const kind = dynamicKind[s.kind] ?? s.kind;
			const article = kind === "db" ? "a" : "an";
			const resource = `${article} ${kind} resource`;
			// Only an expression that names something can go in a list; "" or "%s" cannot.
			const usable = /[A-Za-z_]/.test(s.target) && !/^(?:%\(\w+\)s|%[sd]|:\w+)$/.test(s.target.trim());
			const add = usable
				? `Add ${JSON.stringify(s.target.trim())} to the ${field} of ${resource}, or add`
				: "Add";
			const fix = usable ? { key: field, add: s.target.trim() } : null;
			findings.push(
				F(
					"unresolved-target",
					sev,
					file,
					s,
					null,
					fix,
					`writes ? (${s.via})  unresolved${tag}. ${add} ${resource} that lists this file.`,
				),
			);
			return;
		}
		const name = prop?.key ?? "<resource>";
		const field = s.kind === "fs" ? "paths" : "match";
		if (prop?.match && byKey.has(name)) {
			// The resource exists; only its match is missing. Stripe calls on a client bound elsewhere land here.
			const msg = `writes ${name} (${s.via})  unmapped${tag || " (error)"}. Add ${JSON.stringify(prop.match)} to the ${field} of [resources.${JSON.stringify(name)}]`;
			findings.push(F("unmapped-write", sev, file, s, null, { key: field, add: prop.match }, msg));
			return;
		}
		const extra = prop?.match ? ` ${field} = [${JSON.stringify(prop.match)}]` : "";
		const msg = `writes ${name} (${s.via})  unmapped${tag || " (error)"}. Add [resources.${JSON.stringify(name)}]${extra} writers = [${JSON.stringify(file)}]`;
		findings.push(F("unmapped-write", sev, file, s, null, { key: "resources", add: name }, msg));
	};

	for (const { path: file, facts } of scanned) {
		for (const s of facts.sites) {
			let res = targets(s);
			if (res.length === 0 && s.dynamic) res = listedFor(file, s);
			if (res.length === 0) {
				if (s.kind === "new" || (!s.dynamic && (s.dropIfUnresolved || s.confidence === "low"))) continue;
				if (seen.has(`${file}:${s.line}:?${s.target}`)) continue;
				seen.add(`${file}:${s.line}:?${s.target}`);
				const proposed = s.dynamic ? null : propose(s);
				writeSites++;
				sites.push({ file, site: s, state: s.dynamic ? "unresolved" : "unmapped", resources: [], proposed });
				unmapped(file, s, proposed);
				continue;
			}
			for (const r of res) {
				if (seen.has(`${file}:${s.line}:${r.key}`)) continue;
				seen.add(`${file}:${s.line}:${r.key}`);
				if (s.kind !== "new") writeSites++;
				sites.push({ file, site: s, state: "resolved", resources: [r.key], proposed: null });
				judge(file, s, r);
			}
		}
		for (const c of facts.connections) {
			connections.push({ file, line: c.line, via: c.via });
			if (!cfg.connections || inGlobs(file, cfg.connections.allow)) continue;
			const fix = { key: "allow", add: file };
			const msg = `opens a connection (${c.via})  not allowed. Add under [connections]: allow = [..., ${JSON.stringify(file)}]`;
			findings.push(
				F("undeclared-connection", "error", file, { ...c, family: "connection" }, null, fix, msg),
			);
		}
	}

	for (const g of checkStale ? cfg.grandfathered : []) {
		for (const key of g.resources.filter((k) => !usedGf.has(`${g.glob}|${k}`))) {
			const msg = `stale-grandfathered: ${JSON.stringify(g.glob)} lists ${key} but no write site matches. Remove it.`;
			findings.push(
				F(
					"stale-grandfathered",
					soft(),
					basename(cfg.file),
					{ line: g.line, col: 1, target: g.glob },
					key,
					null,
					msg,
				),
			);
		}
	}
	findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.col - b.col));
	return { findings, sites, files: fileCount, writeSites, connections };
}
