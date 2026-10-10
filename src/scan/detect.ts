// Per-file scan: tokenize once, run every detector, keep only the sites.

import type { Config } from "./matrix.ts";
import { matchOffsets } from "./shared.ts";
import { type FileContext, lineCol, type Preset, type Site, squash, type Tokens } from "./tokens.ts";

export type FoundSite = Site & { line: number; col: number };
export type ConnectionSite = { via: string; line: number; col: number };
export type FileFacts = { sites: FoundSite[]; connections: ConnectionSite[] };

/** What a scan needs from the config; `scanAll` disables the anchor test, `literals` are match texts. */
export type ScanSetup = {
	aliases: Set<string>;
	matchers: FileContext["matchers"];
	connections: Config["connections"];
	scanAll: boolean;
	literals: string[];
};

export function setupFor(cfg: Config): ScanSetup {
	const matchers: FileContext["matchers"] = [];
	for (const r of cfg.resources) {
		for (const matcher of r.match) matchers.push({ resource: r.key, matcher });
	}
	const all = [...matchers.map((m) => m.matcher), ...(cfg.connections?.match ?? [])];
	return {
		aliases: new Set(cfg.resources.flatMap((r) => r.aliases)),
		matchers,
		connections: cfg.connections,
		scanAll: all.some((m) => m.re !== null),
		literals: all.map((m) => m.text),
	};
}

export function scanFile(preset: Preset, source: string, path: string, setup: ScanSetup): FileFacts | null {
	if (!setup.scanAll && !preset.anchor.test(source) && !setup.literals.some((x) => source.includes(x))) {
		return null;
	}
	const t: Tokens = preset.tokenize(source, path);
	const ctx: FileContext = {
		path,
		aliases: setup.aliases,
		matchers: setup.matchers,
		imports: preset.parseImports(t),
		cache: new Map(),
		claimed: new Set(),
	};
	const sites: FoundSite[] = [];
	const seen = new Set<string>();
	for (const d of preset.detectors) {
		for (const h of d.find(t, ctx)) {
			const pos = lineCol(t, h.offset);
			const key = `${pos.line}|${d.family}|${h.via}|${h.target ?? ""}`;
			if (seen.has(key)) continue;
			seen.add(key);
			sites.push({
				family: d.family,
				confidence: d.confidence,
				construction: d.construction,
				dropIfUnresolved: d.dropIfUnresolved,
				kind: "db",
				target: "",
				dynamic: false,
				receiver: "",
				resource: "",
				...h,
				...pos,
			});
		}
	}
	// An SDK call on a line another detector reported is that detector's site: a Supabase table write, a
	// bound http client, a `match` entry.
	const claimedLines = new Set(sites.filter((s) => s.family !== "sdk").map((s) => s.line));
	const kept = sites.filter((s) => s.family !== "sdk" || !claimedLines.has(s.line));
	return { sites: kept, connections: findConnections(preset, t, ctx, setup) };
}

function findConnections(preset: Preset, t: Tokens, ctx: FileContext, setup: ScanSetup): ConnectionSite[] {
	if (!setup.connections) return [];
	const out: ConnectionSite[] = [];
	for (const def of preset.connectionDefaults) {
		const mod = new RegExp(def.module);
		if (!ctx.imports.some((i) => mod.test(i.spec))) continue;
		for (const m of t.code.matchAll(new RegExp(def.pattern, "g"))) {
			out.push({ via: squash(m[0].replace(/\s*\($/, "")), ...lineCol(t, m.index) });
		}
	}
	for (const m of setup.connections.match) {
		for (const hit of matchOffsets(m, t.nc)) out.push({ via: squash(hit.text), ...lineCol(t, hit.at) });
	}
	return out;
}
