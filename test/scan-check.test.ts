import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run as check } from "../src/scan/check.ts";
import { loadConfig } from "../src/scan/matrix.ts";
import { humanOutput } from "../src/scan/output.ts";
import { run as report } from "../src/scan/report.ts";
import { scanProject } from "../src/scan/scan.ts";

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

const temp = (prefix: string): string => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	copies.push(dir);
	return dir;
};

function copy(): string {
	const dir = temp("theodolite-check-");
	cpSync(fixture, dir, { recursive: true });
	return dir;
}

const text = () => out.join("\n");
const tree = (dir: string) => readdirSync(dir, { recursive: true }).sort().join("\n");

const HDR = "// biome-ignore-all lint: fixture\n";
const put = (dir: string, files: Record<string, string>) => {
	for (const [f, body] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, f)), { recursive: true });
		writeFileSync(join(dir, f), body);
	}
};

describe("check: the project fixture end to end", () => {
	// guards: exit code 1 and the exact human lines for each rule: the owner first, then the exact file to widen with
	it("prints one sorted line per finding and exits 1 on errors", async () => {
		expect(await check(["--root", fixture])).toBe(1);
		expect(text().split("\n")).toEqual([
			"src/api/routes/users.js:4  writes db.users (prisma.user.delete)  db.users is written by src/users/**; call it from there, or say in the PR why this file must write it.",
			`src/jobs/export.js:4  writes ? (INSERT INTO \${table})  unresolved (warning). Add "table" to the aliases of a db resource, or add a db resource that lists this file.`,
			"src/jobs/purge.js:4  writes db.legacy_accounts (DELETE FROM legacy_accounts)  write-never: nothing may write db.legacy_accounts. Say in the PR why that must change.",
			"src/jobs/reconcile.js:4  writes db.users (UPDATE users SET)  grandfathered, TODO(tighten)",
			'src/routes/admin.js:5  opens a connection (new PrismaClient)  not allowed. Add under [connections]: allow = [..., "src/routes/admin.js"]',
			'src/sync/push.py:2  writes db.audit_events (INSERT INTO audit_events)  unmapped (warning). Add [resources."db.audit_events"] writers = ["src/sync/push.py"]',
			"src/users/service.js:6  creates db.users (prisma.user.create)  db.users is created by src/users/repository.js; call it from there, or say in the PR why this file must create it.",
			"theodolite: 11 files, 9 write sites, 4 errors, 2 warnings, 1 grandfathered",
		]);
	});

	// guards: the --json shape drifting, which breaks anything that parses it
	it("prints the documented JSON shape", async () => {
		expect(await check(["--root", fixture, "--json"])).toBe(1);
		const doc = JSON.parse(text());
		expect(doc.version).toBe(1);
		expect(doc.summary).toEqual({ files: 11, sites: 9, errors: 4, warnings: 2, notes: 1 });
		expect(doc.doors).toBeUndefined();
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
			fix: { key: "writers", add: "src/api/routes/users.js" },
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
		const empty = temp("theodolite-empty-");
		expect(await check(["--root", empty])).toBe(2);
		expect(err.join("\n")).toContain("theodolite.toml not found");
		expect(await check(["--root", dir, "--nope"])).toBe(2);
	});

	// guards: --config being ignored, so a config outside the scanned tree could not be used
	it("takes the config from --config and scans from the config's directory", async () => {
		expect(await check(["--root", join(fixture, "src"), "--config", join(fixture, "theodolite.toml")])).toBe(
			1,
		);
		expect(text()).toContain("11 files");
	});
});

describe("report: with a config, only [grandfathered] changes", () => {
	// guards: report writing files, editing any existing line, grandfathering a write-never site, or widening writers
	it("keeps every existing line and adds undeclared writes to [grandfathered] only", async () => {
		const dir = copy();
		const before = tree(dir);
		const original = readFileSync(join(dir, "theodolite.toml"), "utf8");
		expect(await report(["--root", dir])).toBe(0);
		expect(tree(dir)).toBe(before);
		const toml = text();
		let at = 0;
		for (const line of original.split("\n").filter((l) => l.trim() !== "")) {
			at = toml.indexOf(line, at);
			expect(at, line).toBeGreaterThanOrEqual(0);
		}
		expect(toml).toContain(
			'[grandfathered]\n"src/jobs/reconcile.js" = ["db.users"]\n"src/api/routes/users.js" = ["db.users"]\n"src/users/service.js" = ["db.users"]',
		);
		expect(toml).toContain(
			"# not grandfathered\n# src/jobs/purge.js:4  writes db.legacy_accounts (DELETE FROM legacy_accounts)  write-never",
		);
		expect(toml).toContain(
			`# unmapped\n# src/jobs/export.js:4  INSERT INTO \${table}\n# src/sync/push.py:2  INSERT INTO audit_events`,
		);
		expect(toml).not.toContain('purge.js" =');
		expect(toml).toContain('writers = ["src/users/**"]\nconstructors = ["src/users/repository.js"]');
	});

	// guards: the reported matrix failing its own check for the grandfathered sites, a second run changing it, or a stale pair surviving
	it("round-trips: only write-never and connections still fail, a second report is identical, and a stale pair is dropped", async () => {
		const dir = copy();
		await report(["--root", dir]);
		const proposed = text();
		writeFileSync(join(dir, "theodolite.toml"), proposed);
		out = [];
		expect(await check(["--root", dir])).toBe(1);
		expect(text()).toContain("2 errors, 2 warnings, 3 grandfathered");
		expect(text()).toContain("write-never");
		expect(text()).toContain("opens a connection");
		out = [];
		await report(["--root", dir]);
		expect(text()).toBe(proposed.trimEnd());

		rmSync(join(dir, "src/jobs/reconcile.js"));
		out = [];
		await report(["--root", dir]);
		expect(text()).not.toContain('"src/jobs/reconcile.js"');
		expect(text()).toContain('"src/users/service.js" = ["db.users"]');
	});

	// guards: a config without the table getting its new entries nowhere, and a Windows file ending up with mixed line endings
	it("appends a [grandfathered] table when there is none, and keeps CRLF files CRLF", async () => {
		const dir = copy();
		const original = readFileSync(join(dir, "theodolite.toml"), "utf8");
		const without = original.slice(0, original.indexOf("[grandfathered]")).replace(/\n/g, "\r\n");
		writeFileSync(join(dir, "theodolite.toml"), without);
		expect(await report(["--root", dir])).toBe(0);
		expect(text()).toContain(
			'[grandfathered]\r\n"src/api/routes/users.js" = ["db.users"]\r\n"src/jobs/reconcile.js" = ["db.users"]\r\n"src/users/service.js" = ["db.users"]',
		);
		expect(text().replace(/\r\n/g, "")).not.toContain("\n");
	});

	// guards: report with no config naming resources that check then rejects, or leaving SDK clients undeclared
	it("round-trips with no starting config and declares constructed SDK clients", async () => {
		const dir = copy();
		rmSync(join(dir, "theodolite.toml"));
		put(dir, {
			"src/lib/stripe.js": `${HDR}import Stripe from "stripe";\nexport const stripe = new Stripe(process.env.KEY);\n`,
			"src/api/pay.js": `${HDR}import { stripe } from "../lib/stripe.js";\nexport const pay = () => stripe.paymentIntents.create({});\n`,
		});
		expect(await report(["--root", dir])).toBe(0);
		const proposed = text();
		expect(proposed).toContain("[scan]");
		expect(proposed).toContain('[resources."external.api.stripe.com"]');
		expect(proposed).toContain(
			'[resources."external.stripe"]\nmatch = ["new Stripe("]\nwriters = [\n  "src/api/pay.js",     # TODO(tighten) 1 site\n  "src/lib/stripe.js",  # TODO(tighten) 1 site\n]',
		);
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
	const proj = (toml: string, files: Record<string, string>): string => {
		const dir = temp("theodolite-dyn-");
		writeFileSync(join(dir, "theodolite.toml"), toml);
		put(dir, Object.fromEntries(Object.entries(files).map(([f, body]) => [`src/${f}`, HDR + body])));
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

	// guards: an SDK call on a client bound in another file going unseen when the resource's match lacks the constructor
	it("tells a config with the resource but not the constructor what to add to match", async () => {
		const dir = proj(
			`${head}\n[resources."external.stripe"]\nmatch = ["api.stripe.com"]\nwriters = ["src/lib/**"]\n`,
			{
				"api/pay.js":
					'import { stripe } from "../lib/stripe.js";\nexport const pay = () => stripe.paymentIntents.create({});\n',
			},
		);
		expect(await check(["--root", dir])).toBe(0);
		expect(text()).toContain(
			'src/api/pay.js:3  writes external.stripe (stripe.paymentIntents.create)  unmapped (warning). Add "new Stripe(" to the match of [resources."external.stripe"]',
		);
	});
});

const git = (dir: string, ...args: string[]) =>
	spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
const commit = (dir: string, message: string) => {
	git(dir, "add", "-A");
	const r = git(dir, "commit", "-q", "-m", message);
	if (r.status !== 0) throw new Error(r.stderr);
};
/** A git repository on `main` with `files` committed. */
function repo(files: Record<string, string>): string {
	const dir = temp("theodolite-base-");
	git(dir, "init", "-q", "-b", "main");
	put(dir, files);
	commit(dir, "base");
	return dir;
}
const USERS = `[scan]\ninclude = ["src/**"]\nlanguages = ["ts"]\n\n[resources."db.users"]\nwriters = ["src/users/**"]\n`;
const UPDATE = `${HDR}export const f = (prisma) => prisma.user.update({});\n`;

describe("check --base: only new sites count, and the door verdict", () => {
	// guards: a site that existed at the base being reported (even after its line moved), an uncommitted or untracked file being missed, and the verdict missing a new writer
	it("reports only the write sites that are new since the base, committed or not", async () => {
		const dir = repo({
			"theodolite.toml": USERS,
			"src/users/a.js": UPDATE,
			"src/api/b.js": `${HDR}export const g = (prisma) => prisma.user.delete({});\n`,
		});
		git(dir, "checkout", "-q", "-b", "feature");
		put(dir, {
			"src/api/b.js": `// moved down a line\n${HDR}export const g = (prisma) => prisma.user.delete({});\n`,
			"src/api/c.js": `${HDR}export const h = (prisma) => prisma.user.create({});\n`,
		});
		expect(await check(["--root", dir, "--base", "main"])).toBe(1);
		expect(text().split("\n")).toEqual([
			"src/api/c.js:2  writes db.users (prisma.user.create)  db.users is written by src/users/**; call it from there, or say in the PR why this file must write it.",
			"theodolite: 2 changed files, 1 new write site, 1 error, 0 warnings, 0 grandfathered",
			"doors: new writer src/api/c.js -> db.users",
		]);
		out = [];
		expect(await check(["--root", dir, "--base", "main", "--json"])).toBe(1);
		expect(JSON.parse(text()).doors).toEqual(["new writer src/api/c.js -> db.users"]);
	});

	// guards: each door type going unreported: schema and CI paths, a dependency added, a test focused and an assertion deleted
	it("lists every door a change opens", async () => {
		const dir = repo({
			"theodolite.toml": USERS,
			"package.json": JSON.stringify({ dependencies: { a: "1.0.0" } }),
			"prisma/schema.prisma": "model User { id Int @id }\n",
			"test/x.test.js": `${HDR}it("a", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n`,
		});
		git(dir, "checkout", "-q", "-b", "feature");
		put(dir, {
			"package.json": JSON.stringify({ dependencies: { a: "1.1.0", stripe: "1.0.0" } }),
			"prisma/schema.prisma": "model User { id Int @id\n name String }\n",
			"test/x.test.js": `${HDR}it.only("a", () => {\n  expect(1).toBe(1);\n});\n`,
			".github/workflows/ci.yml": "name: ci\n",
		});
		commit(dir, "feature");
		expect(await check(["--root", dir, "--base", "main"])).toBe(0);
		expect(text().split("\n")).toEqual([
			"theodolite: 4 changed files, 0 new write sites, 0 errors, 0 warnings, 0 grandfathered",
			'doors: CI path .github/workflows/ci.yml; migration or schema file prisma/schema.prisma; dependency added stripe; skip or only added test/x.test.js (it.only("a", () => {); assertion deleted test/x.test.js (1)',
		]);
	});

	// guards: a change inside the owner module being called a door, so door-free PRs never get the label
	it("prints doors: none for a new write inside the resource's own writers", async () => {
		const dir = repo({ "theodolite.toml": USERS, "src/users/a.js": UPDATE });
		put(dir, { "src/users/a.js": `${UPDATE}export const g = (prisma) => prisma.user.delete({});\n` });
		expect(await check(["--root", dir, "--base", "main"])).toBe(0);
		expect(text().split("\n")).toEqual([
			"theodolite: 1 changed file, 1 new write site, 0 errors, 0 warnings, 0 grandfathered",
			"doors: none",
		]);
	});

	// guards: a repo with no matrix losing the door verdict, which the opinions promise regardless of the matrix
	it("checks doors only when there is no theodolite.toml", async () => {
		const dir = repo({
			"package.json": JSON.stringify({ dependencies: {} }),
			"src/a.js": `${HDR}export const a = 1;\n`,
		});
		put(dir, { "package.json": JSON.stringify({ dependencies: { stripe: "1.0.0" } }) });
		expect(await check(["--root", dir, "--base", "main"])).toBe(0);
		expect(err.join("\n")).toContain("theodolite.toml not found: no matrix to enforce, doors only");
		expect(text().split("\n").pop()).toBe("doors: dependency added stripe");
	});

	// guards: an unknown base ref being scanned as if nothing changed
	it("exits 2 when the base cannot be resolved", async () => {
		const dir = repo({ "theodolite.toml": USERS });
		expect(await check(["--root", dir, "--base", "nope"])).toBe(2);
		expect(err.join("\n")).toContain("cannot find the merge base of nope");
	});
});

describe("check: the grandfathered count may only fall", () => {
	const GF = (pairs: string) => `${USERS}\n[grandfathered]\n${pairs}`;
	const ONE = GF('"src/jobs/x.js" = ["db.users"]\n');
	const TWO = GF('"src/jobs/x.js" = ["db.users"]\n"src/jobs/y.js" = ["db.users"]\n');

	// guards: a [grandfathered] table that grew since the committed matrix passing in CI, so report > theodolite.toml turns findings green for good
	it("warns when the table grew since HEAD or the base, and fails under --strict", async () => {
		const dir = repo({ "theodolite.toml": ONE, "src/jobs/x.js": UPDATE });
		put(dir, { "theodolite.toml": TWO, "src/jobs/y.js": UPDATE });
		expect(await check(["--root", dir])).toBe(0);
		expect(text()).toContain(
			"theodolite.toml:9  [grandfathered] grew from 1 to 2 pairs since HEAD. Shrink it, or say in the PR why.",
		);
		expect(text()).toContain("0 errors, 1 warning, 2 grandfathered");
		out = [];
		expect(await check(["--root", dir, "--strict"])).toBe(1);
		expect(text()).toContain("1 error, 0 warnings, 2 grandfathered");
		out = [];
		expect(await check(["--root", dir, "--base", "main", "--strict"])).toBe(1);
		expect(text()).toContain("[grandfathered] grew from 1 to 2 pairs since the base.");
		commit(dir, "grown");
		out = [];
		expect(await check(["--root", dir, "--strict"])).toBe(0);
	});
});

describe("check: theodolite's own matrix", () => {
	const root = resolve(import.meta.dirname, "..");
	const own = readFileSync(join(root, "theodolite.toml"), "utf8");
	const scan = (toml: string) => {
		const loaded = loadConfig(toml, join(root, "theodolite.toml"));
		if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
		return humanOutput(scanProject(loaded.config));
	};

	// guards: the dogfood paths being decoration: with junk prefixes the files this package writes must become findings
	it("passes as written and fails when its paths are replaced with junk", () => {
		expect(scan(own)).toContain(", 0 errors, 0 warnings");
		const junk = own.replace(/^paths = \[.*\]$/m, 'paths = ["zzz-nothing/"]');
		expect(junk).not.toBe(own);
		const result = scan(junk);
		expect(result).toContain("unmapped (error)");
		expect(result).toContain(".gitignore");
		expect(result).toContain("STATUS.md");
	});
});
