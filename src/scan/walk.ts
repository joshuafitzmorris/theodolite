// Directory walk: include and exclude globs, nested .gitignore, no symlinks, no big or binary files.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { readIfExists } from "../shared/fs.ts";
import { type Config, DEFAULT_EXCLUDES, globRe, inGlobs } from "./matrix.ts";
import { PRESETS } from "./presets/index.ts";
import type { Lang } from "./tokens.ts";

export interface SourceFile {
	path: string;
	abs: string;
	lang: Lang;
}

export const MAX_BYTES = 1_000_000;

const TEST_DIRS = new Set(["test", "tests", "__tests__"]);

/** Test code: `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`, `conftest.py`, and anything under a test directory. */
export function isTestFile(path: string): boolean {
	const parts = path.split("/");
	const name = parts.pop() ?? "";
	return (
		parts.some((p) => TEST_DIRS.has(p)) ||
		/\.(?:test|spec)\./.test(name) ||
		/^test_.*\.py$|_test\.py$|^conftest\.py$/.test(name)
	);
}

interface IgnoreSet {
	base: string;
	rules: { re: RegExp; negate: boolean; dirOnly: boolean }[];
}

function parseIgnore(text: string, base: string): IgnoreSet {
	const rules: IgnoreSet["rules"] = [];
	for (const raw of text.split(/\r?\n/)) {
		let line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const negate = line.startsWith("!");
		if (negate) line = line.slice(1);
		const dirOnly = line.endsWith("/");
		line = line.replace(/\/+$/, "");
		const anchored = line.includes("/");
		const re = globRe(anchored ? line.replace(/^\//, "") : `**/${line}`);
		if (re) rules.push({ re, negate, dirOnly });
	}
	return { base, rules };
}

function ignored(chain: IgnoreSet[], path: string, isDir: boolean): boolean {
	let result = false;
	for (const set of chain) {
		const rel = set.base === "" ? path : path.slice(set.base.length + 1);
		for (const r of set.rules) if ((isDir || !r.dirOnly) && r.re.test(rel)) result = !r.negate;
	}
	return result;
}

export function isBinary(buf: Buffer): boolean {
	return buf.subarray(0, 8000).includes(0);
}

export function walk(cfg: Config): SourceFile[] {
	const ext = new Map<string, Lang>();
	for (const lang of cfg.languages) for (const e of PRESETS[lang].extensions) ext.set(e, lang);
	const excludes = [...DEFAULT_EXCLUDES, ...cfg.exclude];
	const out: SourceFile[] = [];
	const visit = (rel: string, chain: IgnoreSet[]) => {
		const abs = join(cfg.dir, rel);
		const own = readIfExists(join(abs, ".gitignore"));
		const here = own === undefined ? chain : [...chain, parseIgnore(own, rel)];
		const entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
		for (const e of entries) {
			if (e.isSymbolicLink() || e.name === ".git") continue;
			const path = rel === "" ? e.name : `${rel}/${e.name}`;
			if (e.isDirectory()) {
				if (!ignored(here, path, true) && !inGlobs(`${path}/x`, excludes) && !isTestFile(`${path}/x`)) {
					visit(path, here);
				}
				continue;
			}
			const lang = ext.get(extname(e.name));
			if (!e.isFile() || !lang || ignored(here, path, false)) continue;
			if (isTestFile(path) || inGlobs(path, excludes) || !inGlobs(path, cfg.include)) continue;
			if (statSync(join(cfg.dir, path)).size > MAX_BYTES) continue;
			out.push({ path, abs: join(cfg.dir, path), lang });
		}
	};
	visit("", []);
	return out;
}

/** File text, or null for binary files. */
export function readSource(file: SourceFile): string | null {
	const buf = readFileSync(file.abs);
	return isBinary(buf) ? null : buf.toString("utf8");
}
