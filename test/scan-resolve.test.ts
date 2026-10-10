import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig, norm } from "../src/scan/matrix.ts";
import type { Finding } from "../src/scan/resolve.ts";
import { scanProject } from "../src/scan/scan.ts";

const dirs: string[] = [];
afterAll(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Write a project to a temp dir, scan it, and return findings as `rule file:line resource`. */
function scan(toml: string, files: Record<string, string>, strict = false) {
	const dir = mkdtempSync(join(tmpdir(), "theodolite-resolve-"));
	dirs.push(dir);
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	const loaded = loadConfig(toml, join(dir, "theodolite.toml"));
	if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
	const result = scanProject(loaded.config, strict);
	const rows = result.findings.map(
		(f: Finding) => `${f.rule} ${f.file}:${f.line} ${f.resource ?? "-"} ${f.severity}`,
	);
	return { rows, result };
}

const USERS = `[resources."db.users"]\nwriters = ["src/users/**"]\n`;
const WRITE = `export const f = (prisma) => prisma.user.update({});\n`;

describe("resolve: normalisation", () => {
	// guards: table and model names from different ORMs and SQL dialects failing to meet on one key
	it.each([
		["Users", "user"],
		["public.users", "user"],
		['"UserProfile"', "user_profile"],
		["user_profiles", "user_profile"],
		["[dbo].[Orders]", "order"],
		["`order`", "order"],
		["categories", "category"],
		["Category", "category"],
		["status", "status"],
		["address", "address"],
		["HTTPLogs", "http_log"],
	])("normalises %s to %s", (raw, want) => {
		expect(norm(raw)).toBe(want);
	});

	// guards: camelCase models, quoted schema tables and plural names resolving to different resources
	it("sends every spelling of one table to one resource", () => {
		const toml = `[resources."db.user_profiles"]\nwriters = []\n`;
		const files = {
			"src/a.js": `export const f = async (prisma, db) => {
  await prisma.userProfile.create({});
  await db.query('INSERT INTO "public"."UserProfiles" (a) VALUES (1)');
  await db.query("DELETE FROM user_profile");
};\n`,
		};
		const { rows } = scan(toml, files);
		expect(rows.filter((r) => r.includes("db.user_profiles"))).toHaveLength(3);
	});

	// guards: tables = [...] being ignored for resources whose SQL name differs from the key
	it("resolves a table listed under tables", () => {
		const toml = `[resources."db.orders"]\nwriters = []\ntables = ["purchase_orders"]\n`;
		const { rows } = scan(toml, {
			"src/a.js": `export const f = (db) => db.query("DELETE FROM purchase_orders");\n`,
		});
		expect(rows).toEqual(["write-never src/a.js:1 db.orders error"]);
	});
});

describe("resolve: aliases", () => {
	// guards: an alias not rescuing a low-confidence receiver or a dynamic table expression
	it("resolves a low-confidence receiver and a dynamic expression through aliases", () => {
		const toml = `[resources."db.users"]\nwriters = []\naliases = ["userStore", "usersTable"]\n`;
		const files = {
			"src/a.js": `export const f = async (userStore, db, usersTable) => {
  await userStore.save(u);
  await db.query(\`UPDATE \${usersTable} SET a = 1\`);
};\n`,
		};
		expect(scan(toml, files).rows).toEqual([
			"write-never src/a.js:2 db.users error",
			"write-never src/a.js:3 db.users error",
		]);
	});

	// guards: low-confidence receiver sites becoming findings when no alias claims them
	it("drops a low-confidence receiver site that no alias claims", () => {
		const { rows, result } = scan(USERS, {
			"src/other/a.js": `export const f = (cache) => cache.save(x);\n`,
		});
		expect(rows).toEqual([]);
		expect(result.writeSites).toBe(0);
	});
});

describe("resolve: writers, grandfathered and write-never", () => {
	// guards: a file inside writers being flagged, or one outside not being flagged with the right fix
	it("passes a writer and flags a non-writer with the directory glob", () => {
		const { rows, result } = scan(USERS, { "src/users/a.js": WRITE, "src/api/routes/b.js": WRITE });
		expect(rows).toEqual(["undeclared-write src/api/routes/b.js:1 db.users error"]);
		expect(result.findings[0]?.fix).toEqual({ key: "writers", add: "src/api/routes/**" });
	});

	// guards: grandfathered files failing the build instead of producing a TODO(tighten) note
	it("turns a grandfathered write into a note", () => {
		const toml = `${USERS}\n[grandfathered]\n"src/jobs/reconcile.js" = ["db.users"]\n`;
		const { rows } = scan(toml, { "src/jobs/reconcile.js": WRITE });
		expect(rows).toEqual(["grandfathered src/jobs/reconcile.js:1 db.users note"]);
	});

	// guards: a grandfathered entry outranking write-never, or write-never being skipped
	it("reports write-never for writers = [] and lets a grandfathered file through", () => {
		const toml = `[resources."db.users"]\nwriters = []\n\n[grandfathered]\n"src/old/**" = ["db.users"]\n`;
		const { rows } = scan(toml, { "src/new/a.js": WRITE, "src/old/b.js": WRITE });
		expect(rows).toEqual([
			"write-never src/new/a.js:1 db.users error",
			"grandfathered src/old/b.js:1 db.users note",
		]);
	});

	// guards: a grandfathered pair that no longer has a site staying in the file forever
	it("warns about a stale grandfathered pair, and errors under --strict", () => {
		const toml = `${USERS}\n[grandfathered]\n"src/jobs/gone.js" = ["db.users"]\n`;
		const files = { "src/users/a.js": WRITE };
		expect(scan(toml, files).rows).toEqual(["stale-grandfathered theodolite.toml:5 db.users warning"]);
		expect(scan(toml, files, true).rows).toEqual(["stale-grandfathered theodolite.toml:5 db.users error"]);
	});

	// guards: a grandfathered entry for a file that is already a writer being treated as in use
	it("calls a grandfathered pair stale when the file is already a declared writer", () => {
		const toml = `${USERS}\n[grandfathered]\n"src/users/a.js" = ["db.users"]\n`;
		expect(scan(toml, { "src/users/a.js": WRITE }).rows).toEqual([
			"stale-grandfathered theodolite.toml:5 db.users warning",
		]);
	});
});

describe("resolve: constructors", () => {
	const toml = `[resources."db.users"]\nwriters = ["src/users/**"]\nconstructors = ["src/users/repository.js"]\naliases = ["User"]\n`;
	const create = `export const f = (prisma) => prisma.user.create({});\n`;

	// guards: creation inside writers but outside constructors passing, which the doc says it must not
	it("flags a create inside writers but outside constructors", () => {
		const { rows, result } = scan(toml, {
			"src/users/repository.js": create,
			"src/users/service.js": create,
		});
		expect(rows).toEqual(["undeclared-constructor src/users/service.js:1 db.users error"]);
		expect(result.findings[0]?.fix).toEqual({ key: "constructors", add: "src/users/service.js" });
	});

	// guards: update and delete being treated as construction
	it("lets a writer update without being a constructor", () => {
		expect(scan(toml, { "src/users/service.js": WRITE }).rows).toEqual([]);
	});

	// guards: new on an alias escaping the constructors rule
	it("flags new on an aliased class outside constructors", () => {
		const { rows, result } = scan(toml, { "src/users/service.js": `export const u = new User({});\n` });
		expect(rows).toEqual(["undeclared-constructor src/users/service.js:1 db.users error"]);
		expect(result.writeSites).toBe(0);
	});

	// guards: the constructors rule firing when constructors is unset
	it("ignores construction when constructors is unset", () => {
		const open = `[resources."db.users"]\nwriters = ["src/users/**"]\naliases = ["User"]\n`;
		expect(scan(open, { "src/users/service.js": `${create}export const u = new User({});\n` }).rows).toEqual(
			[],
		);
	});
});

describe("resolve: connections", () => {
	const client = `import { PrismaClient } from "@prisma/client";\nexport const p = new PrismaClient();\n`;

	// guards: the connections rule running when the section is absent
	it("is off when [connections] is absent", () => {
		expect(scan(USERS, { "src/a.js": client }).rows).toEqual([]);
	});

	// guards: a client opened outside allow passing, or the allowed file being flagged
	it("flags a connection outside allow", () => {
		const toml = `${USERS}\n[connections]\nallow = ["src/db/client.js"]\n`;
		const { rows, result } = scan(toml, { "src/db/client.js": client, "src/routes/admin.js": client });
		expect(rows).toEqual(["undeclared-connection src/routes/admin.js:2 - error"]);
		expect(result.findings[0]?.fix).toEqual({ key: "allow", add: "src/routes/**" });
	});

	// guards: a class named Client from an unrelated package counting as a database connection
	it("requires the default pattern's package to be imported", () => {
		const toml = `${USERS}\n[connections]\nallow = []\n`;
		const other = `import { Client } from "some-chat-sdk";\nexport const c = new Client();\n`;
		const pg = `import { Client } from "pg";\nexport const c = new Client();\n`;
		expect(scan(toml, { "src/a.js": other }).rows).toEqual([]);
		expect(scan(toml, { "src/b.js": pg }).rows).toEqual(["undeclared-connection src/b.js:2 - error"]);
	});

	// guards: connections.match entries being ignored
	it("adds user match entries to the language defaults", () => {
		const toml = `${USERS}\n[connections]\nallow = []\nmatch = ["openLedger("]\n`;
		expect(scan(toml, { "src/a.js": `export const l = openLedger();\n` }).rows).toEqual([
			"undeclared-connection src/a.js:1 - error",
		]);
	});
});

describe("resolve: unmapped targets follow scan.unmapped", () => {
	const files = {
		"src/a.js": `export const f = (db, t) => {\n  db.query("INSERT INTO audit_events (a) VALUES (1)");\n  db.query(\`DELETE FROM \${t}\`);\n};\n`,
	};
	const base = (policy: string) => `[scan]\nunmapped = "${policy}"\n\n${USERS}`;

	// guards: the default policy dropping or hardening unmapped and unresolved sites
	it("warns by default, for both unmapped names and unresolved targets", () => {
		expect(scan(base("warn"), files).rows).toEqual([
			"unmapped-write src/a.js:2 - warning",
			"unresolved-target src/a.js:3 - warning",
		]);
	});

	// guards: ignore still reporting, or error not hardening
	it("honours ignore and error", () => {
		expect(scan(base("ignore"), files).rows).toEqual([]);
		expect(scan(base("error"), files).rows).toEqual([
			"unmapped-write src/a.js:2 - error",
			"unresolved-target src/a.js:3 - error",
		]);
	});

	// guards: --strict leaving warnings as warnings
	it("makes warnings errors under strict", () => {
		expect(scan(base("warn"), files, true).rows).toEqual([
			"unmapped-write src/a.js:2 - error",
			"unresolved-target src/a.js:3 - error",
		]);
	});

	// guards: the proposed resource name and fix for an unmapped site
	it("proposes a db resource for an unmapped table", () => {
		const { result } = scan(base("warn"), files);
		expect(result.findings[0]?.message).toContain('Add [resources."db.audit_events"] writers = ["src/**"]');
		expect(result.findings[1]?.message).toContain(
			'Add "t" to the aliases of a db resource, or add a db resource that lists this file.',
		);
	});

	// guards: listing a file by exact path not resolving a "?" site as the doc promises
	it("counts a dynamic site for each resource that lists the file by exact path", () => {
		const toml = `[resources."db.users"]\nwriters = ["src/a.js"]\n`;
		const { rows, result } = scan(toml, {
			"src/a.js": `export const f = (db, t) => db.query(\`DELETE FROM \${t}\`);\n`,
		});
		expect(rows).toEqual([]);
		expect(result.sites[0]?.resources).toEqual(["db.users"]);
	});
});

describe("resolve: suggestions are safe to paste", () => {
	const toml = `[resources."external.stripe"]\nmatch = ["api.stripe.com"]\nwriters = []\n\n${USERS}`;
	const msgs = (files: Record<string, string>) => scan(toml, files).result.findings.map((f) => f.message);

	// guards: a suggestion naming the first resource of the kind, and quotes that break the pasted TOML
	it("never names an existing resource and quotes the expression as JSON", () => {
		const D = "$";
		const out = msgs({
			"src/a.js": `export const f = (API) => fetch(\`${D}{API}/orders\`, { method: "POST" });\n`,
			"src/b.js": `export const g = (db, tables) => db.query(\`DELETE FROM ${D}{tables["a"]}\`);\n`,
		});
		expect(out).toHaveLength(2);
		expect(out.join("\n")).not.toContain("external.stripe");
		expect(out.join("\n")).not.toContain("db.users");
		expect(out[0]).toContain(
			`Add "${D}{API}/orders" to the match of an external resource, or add an external`,
		);
		expect(out[1]).toContain('Add "tables[\\"a\\"]" to the aliases of a db resource');
	});

	// guards: an empty or placeholder expression turned into `Add ""`
	it("suggests no expression when the target has none", () => {
		const py = `def f(cur, t):\n    cur.execute("DELETE FROM {}".format(t))\n    cur.execute("DELETE FROM %s" % t)\n`;
		const out = scan(`[scan]\nlanguages = ["py"]\n\n${USERS}`, { "src/a.py": py }).result.findings;
		expect(out).toHaveLength(2);
		for (const f of out) {
			expect(f.message).not.toMatch(/Add ""|Add "%s"|Add "\s+"/);
			expect(f.message).toContain("Add a db resource that lists this file.");
			expect(f.fix).toBeNull();
		}
	});
});

describe("resolve: medium-confidence sites reach their table in either number", () => {
	// guards: statuses/Status, movies/Movie, cookies/Cookie, buses/Bus, analyses/Analysis, aliases/Alias not meeting
	it.each([
		["statuses", "Status"],
		["movies", "Movie"],
		["cookies", "Cookie"],
		["buses", "Bus"],
		["analyses", "Analysis"],
		["aliases", "Alias"],
	])("db.%s receives %s.create", (table, model) => {
		const { rows } = scan(`[resources."db.${table}"]\nwriters = []\n`, {
			"src/a.js": `export const f = () => ${model}.create({});\n`,
		});
		expect(rows).toEqual([`write-never src/a.js:1 db.${table} error`]);
	});
});
