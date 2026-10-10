import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run as check } from "../src/scan/check.ts";
import { run as report } from "../src/scan/report.ts";

const fixture = resolve(import.meta.dirname, "fixtures/scan/project");
const copies: string[] = [];
let out: string[] = [];
let err: string[] = [];

beforeEach(() => {
	out = [];
	err = [];
	vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
	vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
	for (const d of copies) rmSync(d, { recursive: true, force: true });
});

function copy(): string {
	const dir = mkdtempSync(join(tmpdir(), "theodolite-check-"));
	copies.push(dir);
	cpSync(fixture, dir, { recursive: true });
	return dir;
}

const text = () => out.join("\n");
const tree = (dir: string) => readdirSync(dir, { recursive: true }).sort().join("\n");

describe("check: the project fixture end to end", () => {
	// guards: exit code 1 and the exact human lines the doc specifies for each rule
	it("prints one sorted line per finding and exits 1 on errors", async () => {
		expect(await check(["--root", fixture])).toBe(1);
		expect(text().split("\n")).toEqual([
			'src/api/routes/users.js:4  writes db.users (prisma.user.delete)  not declared. Add under [resources."db.users"]: writers = [..., "src/api/routes/**"]',
			`src/jobs/export.js:4  writes ? (INSERT INTO \${table})  unresolved (warning). Add "table" to the aliases of a db resource, or add a db resource that lists this file.`,
			"src/jobs/purge.js:4  writes db.legacy_accounts (DELETE FROM legacy_accounts)  write-never.",
			"src/jobs/reconcile.js:4  writes db.users (UPDATE users SET)  grandfathered, TODO(tighten)",
			'src/routes/admin.js:5  opens a connection (new PrismaClient)  not allowed. Add under [connections]: allow = [..., "src/routes/**"]',
			'src/sync/push.py:2  writes db.audit_events (INSERT INTO audit_events)  unmapped (warning). Add [resources."db.audit_events"] writers = ["src/sync/**"]',
			'src/users/service.js:6  writes db.users (prisma.user.create)  not a constructor. Add under [resources."db.users"]: constructors = [..., "src/users/service.js"]',
			"theodolite: 11 files, 9 write sites, 4 errors, 2 warnings, 1 grandfathered",
		]);
	});

	// guards: the --json shape drifting, which breaks anything that parses it
	it("prints the documented JSON shape", async () => {
		expect(await check(["--root", fixture, "--json"])).toBe(1);
		const doc = JSON.parse(text());
		expect(doc.version).toBe(1);
		expect(doc.summary).toEqual({ files: 11, sites: 9, errors: 4, warnings: 2, notes: 1 });
		expect(Object.keys(doc.findings[0])).toEqual([
			"rule",
			"severity",
			"file",
			"line",
			"col",
			"resource",
			"target",
			"via",
			"family",
			"confidence",
			"fix",
		]);
		const byRule = (rule: string) => doc.findings.find((f: { rule: string }) => f.rule === rule);
		expect(byRule("undeclared-write")).toMatchObject({
			severity: "error",
			file: "src/api/routes/users.js",
			line: 4,
			resource: "db.users",
			target: "user",
			via: "prisma.user.delete",
			family: "prisma",
			confidence: "high",
			fix: { key: "writers", add: "src/api/routes/**" },
		});
		expect(byRule("unresolved-target").resource).toBeNull();
		expect(byRule("unmapped-write").resource).toBeNull();
		expect(byRule("grandfathered").severity).toBe("note");
	});

	// guards: warnings failing the build without --strict, or passing with it
	it("exits 0 on warnings alone and 1 under --strict", async () => {
		const dir = copy();
		for (const f of ["api/routes/users.js", "jobs/purge.js", "routes/admin.js", "users/service.js"]) {
			rmSync(join(dir, "src", f));
		}
		expect(await check(["--root", dir])).toBe(0);
		expect(text()).toContain("0 errors, 2 warnings, 1 grandfathered");
		out = [];
		expect(await check(["--root", dir, "--strict"])).toBe(1);
		expect(text()).toContain("2 errors, 0 warnings, 1 grandfathered");
	});

	// guards: a config error exiting 1 or losing its position, and a missing config being scanned as empty
	it("exits 2 with a positioned message on a config error or a missing config", async () => {
		const dir = copy();
		writeFileSync(join(dir, "theodolite.toml"), `[resources."db.users"]\nwriter = []\n`);
		expect(await check(["--root", dir])).toBe(2);
		expect(err.join("\n")).toContain('theodolite.toml:2:1  unknown key "writer"');
		err = [];
		const empty = mkdtempSync(join(tmpdir(), "theodolite-empty-"));
		copies.push(empty);
		expect(await check(["--root", empty])).toBe(2);
		expect(err.join("\n")).toContain("theodolite.toml not found");
		expect(await check(["--root", dir, "--nope"])).toBe(2);
	});

	// guards: --architecture printing findings, or exiting non-zero while errors exist
	it("prints the Who writes what section and exits 0", async () => {
		expect(await check(["--root", fixture, "--architecture"])).toBe(0);
		expect(text().split("\n")).toEqual([
			"## Who writes what",
			"",
			"- `db.legacy_accounts`: writers none (write-never); constructors unset; grandfathered 0",
			"- `db.users`: writers `src/users/**`; constructors `src/users/repository.js`; grandfathered 1",
			"- `external.stripe`: writers `src/billing/**`; constructors unset; grandfathered 0",
		]);
	});

	// guards: --config being ignored, so a config outside the scanned tree could not be used
	it("takes the config from --config and scans from the config's directory", async () => {
		expect(await check(["--root", join(fixture, "src"), "--config", join(fixture, "theodolite.toml")])).toBe(
			1,
		);
		expect(text()).toContain("11 files");
	});
});

describe("report: a proposed matrix that check accepts", () => {
	// guards: report writing files, or dropping the existing sections, globs and allow list it was given
	it("keeps every existing line and appends only new writers, writing nothing", async () => {
		const dir = copy();
		const before = tree(dir);
		const original = readFileSync(join(dir, "theodolite.toml"), "utf8");
		expect(await report(["--root", dir])).toBe(0);
		expect(tree(dir)).toBe(before);
		const toml = text();
		// every original line survives, in order
		let at = 0;
		// one-line arrays are the only lines that change: their entries move onto lines of their own
		const arrays = /^(?:writers|constructors|allow) = \[.*\]$/;
		for (const line of original.split("\n").filter((l) => l.trim() !== "" && !arrays.test(l))) {
			at = toml.indexOf(line, at);
			expect(at, line).toBeGreaterThanOrEqual(0);
		}
		expect(toml).toContain('[grandfathered]\n"src/jobs/reconcile.js" = ["db.users"]');
		expect(toml).toContain(
			'writers = [\n  "src/users/**",\n  "src/api/routes/users.js",  # TODO(tighten) 1 site\n]',
		);
		expect(toml).toContain('"src/jobs/purge.js",  # TODO(tighten) 1 site');
		expect(toml).toContain(
			'allow = [\n  "src/db/client.js",\n  "src/routes/admin.js",  # TODO(tighten) 1 site\n]',
		);
		expect(toml).toContain('constructors = [\n  "src/users/repository.js",\n  "src/users/service.js",');
		expect(toml).toContain('[resources."db.audit_events"]');
		expect(toml.indexOf('[resources."db.audit_events"]')).toBeGreaterThan(toml.indexOf("[grandfathered]"));
		expect(toml).toContain(`# unmapped\n# src/jobs/export.js:4  INSERT INTO \${table}`);
	});

	// guards: the reported toml failing its own check, which would make report useless as a starting point
	it("round-trips: the reported matrix passes check, and dropping one writer fails it with the entry to add", async () => {
		const dir = copy();
		await report(["--root", dir]);
		const proposed = text();
		writeFileSync(join(dir, "theodolite.toml"), proposed);
		out = [];
		expect(await check(["--root", dir])).toBe(0);
		expect(text()).toContain("0 errors");
		out = [];
		await report(["--root", dir]);
		expect(text()).toBe(proposed.trimEnd());

		const trimmed = proposed.replace(/^ {2}"src\/jobs\/purge\.js",.*\n/m, "");
		expect(trimmed).not.toBe(proposed);
		writeFileSync(join(dir, "theodolite.toml"), trimmed);
		out = [];
		expect(await check(["--root", dir])).toBe(1);
		expect(text()).toContain("write-never");
	});

	// guards: a Windows file ending up with mixed line endings, or the entries of a one-line array lost
	it("keeps CRLF files CRLF and the entries of an expanded one-line array", async () => {
		const dir = copy();
		const toml = readFileSync(join(dir, "theodolite.toml"), "utf8").replace(/\n/g, "\r\n");
		writeFileSync(join(dir, "theodolite.toml"), toml);
		expect(await report(["--root", dir])).toBe(0);
		expect(text()).toContain(
			'writers = [\r\n  "src/users/**",\r\n  "src/api/routes/users.js",  # TODO(tighten) 1 site\r\n]',
		);
		expect(text().replace(/\r\n/g, "")).not.toContain("\n");
	});

	// guards: report with no config naming resources that check then rejects or cannot find
	it("round-trips with no starting config", async () => {
		const dir = copy();
		rmSync(join(dir, "theodolite.toml"));
		expect(await report(["--root", dir])).toBe(0);
		const proposed = text();
		expect(proposed).toContain("[scan]");
		expect(proposed).toContain('[resources."external.api.stripe.com"]');
		expect(proposed).toContain('match = ["api.stripe.com"]');
		writeFileSync(join(dir, "theodolite.toml"), proposed);
		out = [];
		expect(await check(["--root", dir])).toBe(0);
		expect(readFileSync(join(dir, "theodolite.toml"), "utf8")).toBe(proposed);
	});
});

describe("check: an include that matches nothing", () => {
	// guards: a typo in scan.include scanning zero files silently; a new repo with no source must still pass
	it("warns and exits 0 when the walk finds no files, and fails under --strict", async () => {
		const dir = copy();
		writeFileSync(
			join(dir, "theodolite.toml"),
			`[scan]\ninclude = ["lib/**"]\n\n[resources."db.users"]\nwriters = []\n`,
		);
		expect(await check(["--root", dir])).toBe(0);
		expect(err.join("\n")).toContain("include matched no files");
		expect(await check(["--root", dir, "--strict"])).toBe(1);
	});
});

describe("check: dynamic targets in listed files", () => {
	const hdr = "// biome-ignore-all lint: fixture\n";
	const proj = (toml: string, files: Record<string, string>): string => {
		const dir = mkdtempSync(join(tmpdir(), "theodolite-dyn-"));
		copies.push(dir);
		mkdirSync(join(dir, "src/gen"), { recursive: true });
		writeFileSync(join(dir, "theodolite.toml"), toml);
		for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, "src", f), hdr + body);
		return dir;
	};
	const head = '[scan]\ninclude = ["src/**"]\nlanguages = ["ts"]\n';
	const fsWrite =
		'import { writeFileSync } from "node:fs";\nexport const w = (p) => writeFileSync(p, "x");\n';

	// guards: a glob-listed file's dynamic fs or db write being reported as unresolved
	it("attributes a dynamic fs path and a dynamic db table to the listed resource of that kind", async () => {
		const dir = proj(
			`${head}\n[resources."fs.gen"]\npaths = ["gen/"]\nwriters = ["src/gen/**"]\n\n[resources."db.rows"]\nwriters = ["src/gen/**"]\n`,
			{
				"gen/a.js": fsWrite,
				"gen/b.js": ["export const d = (db, t) => db.query(`INSERT INTO $", "{t} (a) VALUES (1)`);\n"].join(
					"",
				),
			},
		);
		expect(await check(["--root", dir, "--strict"])).toBe(0);
		expect(text()).toContain("2 write sites, 0 errors, 0 warnings");
	});

	// guards: an unlisted dynamic write passing silently, --strict not escalating it, and the old "list in writers" advice
	it("warns on an unlisted dynamic path, errors under --strict, and never says to list a listed file", async () => {
		const dir = proj(
			`${head}\n[resources."fs.gen"]\npaths = ["gen/"]\nwriters = ["src/gen/**"]\n\n[resources."db.rows"]\nwriters = ["src/db/**"]\n`,
			{ "other.js": fsWrite, "gen/a.js": fsWrite },
		);
		expect(await check(["--root", dir])).toBe(0);
		expect(text()).toContain('src/other.js:3  writes ? (writeFileSync)  unresolved (warning). Add "p" to');
		expect(text()).toContain("the paths of an fs resource, or add an fs resource that lists this file.");
		expect(text()).not.toContain("in writers");
		expect(text()).toContain("2 write sites, 0 errors, 1 warning");
		out = [];
		expect(await check(["--root", dir, "--strict"])).toBe(1);
		expect(text()).toContain("1 error, 0 warnings");
	});
});
