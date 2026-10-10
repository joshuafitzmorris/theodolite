// `check --base <ref>`: scan only the files changed since the merge base with <ref>, count only the write
// sites that are new, and list the doors the change opens.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readIfExists } from "../shared/fs.ts";
import { type FileFacts, scanFile, setupFor } from "./detect.ts";
import { type Config, inGlobs } from "./matrix.ts";
import { PRESETS } from "./presets/index.ts";
import { type Resolved, type ResolveResult, resolveAll } from "./resolve.ts";
import { squash } from "./tokens.ts";
import { isBinary, isTestFile, readSource, walk } from "./walk.ts";

/** Paths whose change is a door, unless `[doors] paths` in the config replaces the list. */
export const DOOR_PATHS: { label: string; globs: string[] }[] = [
	{
		label: "migration or schema file",
		globs: ["**/migrations/**", "**/schema.prisma", "**/drizzle/**", "**/alembic/**", "**/*.sql"],
	},
	{ label: "auth path", globs: ["**/auth/**", "**/auth.ts", "**/middleware.ts"] },
	{ label: "CI path", globs: [".github/**"] },
];
const DEPENDENCY_FILE =
	/(?:^|\/)(?:package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|go\.mod|Cargo\.toml|Gemfile)$/;
const SKIP_ADDED = /\.(?:only|skip)\s*\(|\b(?:xit|xdescribe|xtest)\s*\(|@pytest\.mark\.skip/;
const ASSERTION = /\b(?:expect|assert\w*)\s*[(.]|^\s*assert\s|\.should\b/;

function git(dir: string, args: string[]): { ok: boolean; out: string } {
	const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	return { ok: r.status === 0, out: r.status === 0 ? r.stdout : r.stderr };
}

export type Changed = { mergeBase: string; prefix: string; files: string[] };

/** Files changed between the merge base with `base` and the working tree, as paths relative to `dir`. */
export function changedFiles(dir: string, base: string): Changed | { error: string } {
	const mb = git(dir, ["merge-base", base, "HEAD"]);
	if (!mb.ok) {
		const why = mb.out.trim() || "not a git repository, or the ref is unknown";
		return { error: `cannot find the merge base of ${base} and HEAD: ${why}` };
	}
	const mergeBase = mb.out.trim();
	const prefix = git(dir, ["rev-parse", "--show-prefix"]).out.trim();
	const diff = git(dir, ["diff", "--name-only", "--relative", "-z", mergeBase]);
	if (!diff.ok) return { error: diff.out.trim() };
	const untracked = git(dir, ["ls-files", "--others", "--exclude-standard", "-z"]);
	const files = new Set([...diff.out.split("\0"), ...untracked.out.split("\0")].filter((f) => f !== ""));
	return { mergeBase, prefix, files: [...files].sort() };
}

const atBase = (dir: string, changed: Changed, file: string): string | null => {
	const shown = git(dir, ["show", `${changed.mergeBase}:${changed.prefix}${file}`]);
	return shown.ok && !isBinary(Buffer.from(shown.out)) ? shown.out : null;
};

const siteKey = (s: FileFacts["sites"][number]) => `${s.kind}|${s.family}|${s.via}|${s.target}|${s.receiver}`;

/** The sites in `head` that `base` did not have, matched by what they are, not by line number. */
export function newSites(head: FileFacts, base: FileFacts | null): FileFacts {
	if (!base) return head;
	const minus = <T>(items: T[], had: T[], key: (x: T) => string): T[] => {
		const seen = new Map<string, number>();
		for (const x of had) seen.set(key(x), (seen.get(key(x)) ?? 0) + 1);
		return items.filter((x) => {
			const n = seen.get(key(x)) ?? 0;
			if (n === 0) return true;
			seen.set(key(x), n - 1);
			return false;
		});
	};
	return {
		sites: minus(head.sites, base.sites, siteKey),
		connections: minus(head.connections, base.connections, (c) => c.via),
	};
}

const EMPTY: FileFacts = { sites: [], connections: [] };

export type BaseScan = { result: ResolveResult; doors: string[]; mergeBase: string };

export function scanChanged(cfg: Config, base: string, strict: boolean): BaseScan | { error: string } {
	const changed = changedFiles(cfg.dir, base);
	if ("error" in changed) return changed;
	const set = new Set(changed.files);
	const setup = setupFor(cfg);
	const files = walk(cfg).filter((f) => set.has(f.path));
	const head: { path: string; facts: FileFacts }[] = [];
	const before: { path: string; facts: FileFacts }[] = [];
	for (const f of files) {
		const source = readSource(f);
		if (source === null) continue;
		const now = scanFile(PRESETS[f.lang], source, f.path, setup) ?? EMPTY;
		const old = atBase(cfg.dir, changed, f.path);
		const was = old === null ? null : (scanFile(PRESETS[f.lang], old, f.path, setup) ?? EMPTY);
		if (was) before.push({ path: f.path, facts: was });
		head.push({ path: f.path, facts: newSites(now, was) });
	}
	const result = resolveAll(cfg, head, changed.files.length, strict, false);
	const previous = resolveAll(cfg, before, before.length, strict, false);
	return { result, doors: findDoors(cfg, changed, result, previous), mergeBase: changed.mergeBase };
}

const resourceOf = (s: Resolved) => s.resources[0] ?? s.proposed?.key ?? "?";

/** One entry per door the change opens, in a fixed order: writers, paths, dependencies, tests. */
export function findDoors(cfg: Config, changed: Changed, head: ResolveResult, base: ResolveResult): string[] {
	const doors: string[] = [];
	const pairOf = (s: Resolved) => `${s.file}|${resourceOf(s)}`;
	const had = new Set(base.sites.map(pairOf));
	const seen = new Set<string>();
	for (const s of head.sites) {
		if (had.has(pairOf(s)) || seen.has(pairOf(s))) continue;
		seen.add(pairOf(s));
		const resource = resourceOf(s);
		const external = s.site.kind === "http" || /^(?:external|effect)\./.test(resource);
		doors.push(`${external ? "new external call" : "new writer"} ${s.file} -> ${resource}`);
	}
	const groups = cfg.doors ? [{ label: "door path", globs: cfg.doors }] : DOOR_PATHS;
	for (const file of changed.files) {
		const group = groups.find((g) => inGlobs(file, g.globs));
		if (group) doors.push(`${group.label} ${file}`);
	}
	for (const file of changed.files.filter((f) => DEPENDENCY_FILE.test(f)))
		doors.push(...dependencyDoors(cfg.dir, changed, file));
	for (const file of changed.files.filter(isTestFile)) doors.push(...testDoors(cfg.dir, changed, file));
	return doors;
}

const asObject = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function dependencyDoors(dir: string, changed: Changed, file: string): string[] {
	const after = readIfExists(join(dir, file));
	if (after === undefined) return [`dependency file changed ${file}`];
	const before = atBase(dir, changed, file) ?? "";
	if (file.endsWith("package.json")) {
		const keys = (text: string): Set<string> | null => {
			try {
				const j = asObject(JSON.parse(text || "{}"));
				const fields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
				return new Set(fields.flatMap((k) => Object.keys(asObject(j[k]))));
			} catch {
				return null;
			}
		};
		const was = keys(before);
		const now = keys(after);
		if (!was || !now) return [`dependency file changed ${file}`];
		const added = [...now].filter((k) => !was.has(k)).sort();
		return added.length > 0 ? [`dependency added ${added.join(", ")}`] : [];
	}
	if (/requirements[^/]*\.txt$/.test(file)) {
		const names = (text: string) =>
			new Set(
				text
					.split(/\r?\n/)
					.map((l) => l.trim())
					.filter((l) => l !== "" && !l.startsWith("#") && !l.startsWith("-"))
					.map((l) => l.split(/[=<>~!;\s[]/)[0] ?? l),
			);
		const was = names(before);
		const added = [...names(after)].filter((n) => !was.has(n)).sort();
		return added.length > 0 ? [`dependency added ${added.join(", ")}`] : [];
	}
	return [`dependency file changed ${file}`];
}

/** Added and removed lines of one file against the merge base; an untracked file is all added. */
function diffLines(dir: string, changed: Changed, file: string): { added: string[]; removed: string[] } {
	const added: string[] = [];
	const removed: string[] = [];
	const diff = git(dir, ["diff", "--relative", "-U0", changed.mergeBase, "--", file]);
	if (diff.ok && diff.out.trim() === "" && atBase(dir, changed, file) === null) {
		return { added: (readIfExists(join(dir, file)) ?? "").split(/\r?\n/), removed };
	}
	for (const line of diff.out.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
		else if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
	}
	return { added, removed };
}

function testDoors(dir: string, changed: Changed, file: string): string[] {
	const { added, removed } = diffLines(dir, changed, file);
	const doors: string[] = [];
	const skip = added.find((l) => SKIP_ADDED.test(l));
	if (skip !== undefined) doors.push(`skip or only added ${file} (${squash(skip).slice(0, 60)})`);
	const trimmed = (xs: string[]) => xs.filter((l) => ASSERTION.test(l)).map((l) => l.trim());
	const gone = new Map<string, number>();
	for (const l of trimmed(removed)) gone.set(l, (gone.get(l) ?? 0) + 1);
	for (const l of trimmed(added)) if ((gone.get(l) ?? 0) > 0) gone.set(l, (gone.get(l) ?? 0) - 1);
	const deleted = [...gone.values()].reduce((n, x) => n + x, 0);
	if (deleted > 0) doors.push(`assertion deleted ${file} (${deleted})`);
	return doors;
}
