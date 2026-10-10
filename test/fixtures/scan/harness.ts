import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { begin, scanProject } from "../../../src/scan/scan.ts";

const MARKER = /(?:\/\/|#)\s*expect:\s*(\S+)\s+(high|medium|low)\s*$/;
const GUARDS = /(?:\/\/|#)\s*guards:\s*(.*)$/m;

export type Found = Map<string, Map<number, string[]>>;

/** Numbered fixture files in `<dir>/src`, each with the guard sentence from its header. */
export function fixtureFiles(dir: string): { name: string; guards: string }[] {
	return readdirSync(join(dir, "src"))
		.filter((n) => /^\d\d-/.test(n))
		.sort()
		.map((name) => ({
			name,
			guards: GUARDS.exec(readFileSync(join(dir, "src", name), "utf8"))?.[1] ?? name,
		}));
}

/** Lines that carry an expect marker, as line number to `resource confidence`. */
function expected(dir: string, name: string): Map<number, string> {
	const out = new Map<number, string>();
	readFileSync(join(dir, "src", name), "utf8")
		.split("\n")
		.forEach((row, i) => {
			const m = MARKER.exec(row);
			if (m) out.set(i + 1, `${m[1]} ${m[2]}`);
		});
	return out;
}

/** Every write site the scanner found in the fixture tree: file, then line, then `resource confidence`. */
export function scanFixture(dir: string): Found {
	const started = begin(["--root", dir], "", false);
	if (typeof started === "number") throw new Error("fixture config did not load");
	const out: Found = new Map();
	for (const s of scanProject(started.config).sites) {
		if (s.site.kind === "new") continue;
		const what =
			s.state === "resolved" ? (s.resources[0] ?? "") : s.state === "unresolved" ? "?" : "unmapped";
		const lines = out.get(s.file) ?? new Map<number, string[]>();
		lines.set(s.site.line, [...(lines.get(s.site.line) ?? []), `${what} ${s.site.confidence}`]);
		out.set(s.file, lines);
	}
	return out;
}

/** Differences between markers and sites in one fixture file; empty when they agree. */
export function problems(dir: string, name: string, found: Found): string[] {
	const want = expected(dir, name);
	const got = found.get(`src/${name}`) ?? new Map<number, string[]>();
	const out: string[] = [];
	for (const [line, text] of want) {
		const have = got.get(line) ?? [];
		if (!have.includes(text)) out.push(`${name}:${line} expected "${text}", found ${JSON.stringify(have)}`);
	}
	for (const [line, have] of got) {
		if (!want.has(line)) out.push(`${name}:${line} unexpected site ${JSON.stringify(have)}`);
	}
	return out;
}

/** Files that produced a site although they are not numbered fixture files. */
export const strayFiles = (found: Found): string[] => [...found.keys()].filter((f) => !/^src\/\d\d-/.test(f));
