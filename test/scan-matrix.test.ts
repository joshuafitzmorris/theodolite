import { describe, expect, it } from "vitest";
import { type Config, forms, loadConfig } from "../src/scan/matrix.ts";

function errorsOf(toml: string): string[] {
	const r = loadConfig(toml, "/work/theodolite.toml");
	if (r.ok) return [];
	return r.errors.map((e) => `${e.line}:${e.col}  ${e.message}`);
}

function configOf(toml: string): Config {
	const r = loadConfig(toml, "/work/theodolite.toml");
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.config;
}

describe("matrix: defaults", () => {
	// guards: a config with only a resource silently scanning less or more than the doc's defaults
	it("fills scan defaults and leaves connections off", () => {
		const c = configOf(`[resources."db.users"]\nwriters = ["src/users/**"]\n`);
		expect(c.include).toEqual(["**"]);
		expect(c.exclude).toEqual([]);
		expect(c.languages).toEqual(["ts", "py"]);
		expect(c.unmapped).toBe("warn");
		expect(c.connections).toBeNull();
		expect(c.dir).toBe("/work");
	});

	// guards: write-never being treated as a missing key, which would reject the strongest rule
	it("accepts writers = [] as write-never", () => {
		const c = configOf(`[resources."db.legacy_accounts"]\nwriters = []\n`);
		expect(c.resources[0]?.writers).toEqual([]);
		expect(c.resources[0]?.constructors).toBeNull();
	});

	// guards: regex match entries losing their flags or their global flag, which the scanner relies on
	it("compiles /regex/i match entries and keeps plain entries as substrings", () => {
		const c = configOf(
			`[resources."effect.email"]\nmatch = ["sendEmail(", '/resend\\.send\\(/i']\nwriters = []\n`,
		);
		const [plain, regex] = c.resources[0]?.match ?? [];
		expect(plain?.re).toBeNull();
		expect(regex?.re?.flags).toBe("gi");
		expect(regex?.re?.test("RESEND.SEND(")).toBe(true);
	});

	// guards: db resources demanding match, which the doc makes optional for db
	it("does not require match on db resources", () => {
		expect(errorsOf(`[resources."db.users"]\nwriters = []\n`)).toEqual([]);
	});
});

describe("matrix: errors carry theodolite.toml positions", () => {
	// guards: the unknown-key message losing its line, column or did-you-mean hint
	it("reports an unknown key at its own line with a suggestion", () => {
		const toml = `[scan]\ninclude = ["src/**"]\n\n[resources."db.users"]\nwriter = ["src/users/**"]\n`;
		expect(errorsOf(toml)).toContain(
			`5:1  unknown key "writer" in [resources."db.users"] (did you mean "writers"?)`,
		);
	});

	// guards: a resource with no writers key passing, which would make every write undeclared silently
	it("reports missing writers at the table header", () => {
		expect(errorsOf(`\n[resources."db.users"]\naliases = ["User"]\n`)).toEqual([
			`2:1  missing "writers" in [resources."db.users"] (use [] for write-never)`,
		]);
	});

	// guards: a resource key with an unknown kind or no name being accepted
	it("reports a bad resource key or kind", () => {
		const out = errorsOf(`[resources."users"]\nwriters = []\n\n[resources."table.users"]\nwriters = []\n`);
		expect(out[0]).toMatch(/^1:1 {2}bad resource key "users"/);
		expect(out[1]).toMatch(/^4:1 {2}bad resource key "table.users"/);
	});

	// guards: non-db resources without match, which could never be detected
	it("reports a missing match outside db", () => {
		expect(errorsOf(`[resources."external.stripe"]\nwriters = []\n`)).toEqual([
			`1:1  missing "match" in [resources."external.stripe"]`,
		]);
	});

	// guards: tables and aliases leaking onto non-db resources
	it("reports tables and aliases outside db at the key's line", () => {
		const toml = `[resources."external.stripe"]\nmatch = ["x"]\nwriters = []\naliases = ["A"]\ntables = ["t"]\n`;
		const out = errorsOf(toml);
		expect(out[0]).toMatch(/^4:1 {2}"aliases" is only allowed on db resources/);
		expect(out[1]).toMatch(/^5:1 {2}"tables" is only allowed on db resources/);
	});

	// guards: two resources claiming one table after normalisation, which makes resolution ambiguous
	it("reports a name claimed twice after normalisation", () => {
		const toml = `[resources."db.users"]\nwriters = []\n\n[resources."db.user"]\nwriters = []\n`;
		expect(errorsOf(toml)).toEqual([`4:1  "user" is already claimed by [resources."db.users"]`]);
	});

	// guards: two resources sharing an alias
	it("reports an alias claimed twice", () => {
		const toml = `[resources."db.users"]\nwriters = []\naliases = ["U"]\n\n[resources."db.orders"]\nwriters = []\naliases = ["U"]\n`;
		expect(errorsOf(toml)).toEqual([`7:1  "U" is already claimed by [resources."db.users"]`]);
	});

	// guards: ! globs and empty strings, which minimatch would treat as negation or match nothing
	it("rejects ! globs and empty strings", () => {
		const toml = `[resources."db.users"]\nwriters = ["!src/a/**"]\nconstructors = [""]\n`;
		const out = errorsOf(toml);
		expect(out[0]).toMatch(/^2:1 {2}writers: "!" globs are not supported/);
		expect(out[1]).toBe("3:1  constructors has an empty string");
	});

	// guards: an invalid regex in match being accepted and then throwing mid-scan
	it("reports an invalid regex", () => {
		const toml = `[resources."effect.x"]\nmatch = ["/(/"]\nwriters = []\n`;
		expect(errorsOf(toml)[0]).toMatch(/^2:1 {2}invalid regex \/\(\//);
	});

	// guards: a string where an array is required
	it("reports a wrong value type", () => {
		expect(errorsOf(`[resources."db.users"]\nwriters = "src/**"\n`)).toEqual([
			"2:1  writers must be an array of strings",
		]);
	});

	// guards: grandfathered entries pointing at resources that do not exist
	it("reports an unknown resource in [grandfathered] at its key", () => {
		const toml = `[resources."db.users"]\nwriters = []\n\n[grandfathered]\n"src/jobs/a.ts" = ["db.nope"]\n`;
		expect(errorsOf(toml)).toEqual([`5:1  unknown resource "db.nope" in [grandfathered]`]);
	});

	// guards: a bad enum value for unmapped or languages
	it("reports bad enums", () => {
		const out = errorsOf(`[scan]\nunmapped = "loud"\nlanguages = ["rust"]\n`);
		expect(out).toContain(`2:1  unmapped must be "ignore", "warn" or "error"`);
		expect(out).toContain(`3:1  unknown language "rust" (use "ts" or "py")`);
	});

	// guards: a TOML syntax error losing the parser's own position
	it("cites the TOML parser's position for syntax errors", () => {
		expect(errorsOf(`[scan]\ninclude = = 1\n`)).toEqual(["2:11  Invalid TOML document: invalid value"]);
	});

	// guards: unknown tables being ignored, which hides a misspelled [resources]
	it("reports an unknown top-level table", () => {
		expect(errorsOf(`[resource."db.users"]\nwriters = []\n`)[0]).toBe(
			`1:1  unknown table "resource" (did you mean "resources"?)`,
		);
	});

	// guards: errors printed in file order, so the first line is the first thing to fix
	it("sorts errors by position", () => {
		const toml = `[resources."db.b"]\nwriters = "x"\n\n[resources."db.a"]\nbogus = 1\nwriters = []\n`;
		const lines = errorsOf(toml).map((l) => Number.parseInt(l, 10));
		expect(lines).toEqual([...lines].sort((a, b) => a - b));
	});
});

describe("matrix: scope of this version", () => {
	// guards: [imports] being accepted and then silently doing nothing, which reads as an enforced layering rule
	it("rejects the [imports] table at its own line", () => {
		const toml = `[resources."db.users"]\nwriters = []\n\n[imports]\n"src/db/**" = ["src/users/**"]\n`;
		expect(errorsOf(toml)).toEqual(["4:1  [imports] is not supported in this version"]);
	});
});

describe("matrix: fs resources use paths", () => {
	// guards: `match` meaning path prefixes on fs but source text everywhere else, with no hint to rename it
	it("rejects match on fs with the fix, and asks for paths when neither key is there", () => {
		expect(errorsOf(`[resources."fs.uploads"]\nmatch = ["uploads/"]\nwriters = []\n`)).toEqual([
			`2:1  "match" on fs resources was renamed to "paths" ([resources."fs.uploads"]); rename the key`,
		]);
		expect(errorsOf(`[resources."fs.uploads"]\nwriters = []\n`)).toEqual([
			`1:1  missing "paths" in [resources."fs.uploads"]`,
		]);
		expect(
			configOf(`[resources."fs.uploads"]\npaths = ["uploads/"]\nwriters = []\n`).resources[0]?.paths,
		).toEqual(["uploads/"]);
		expect(errorsOf(`[resources."effect.x"]\nmatch = ["x"]\npaths = ["y"]\nwriters = []\n`)[0]).toMatch(
			/^3:1 {2}"paths" is only allowed on fs resources/,
		);
	});
});

describe("matrix: singular and plural", () => {
	// guards: plural and singular spellings that a single rule cannot join, which dropped medium-confidence ORM sites
	it.each([
		["statuses", "Status"],
		["movies", "Movie"],
		["cookies", "Cookie"],
		["buses", "Bus"],
		["analyses", "Analysis"],
		["aliases", "Alias"],
		["categories", "Category"],
		["boxes", "Box"],
		["addresses", "Address"],
	])("%s and %s share a form", (plural, singular) => {
		expect(forms(plural).some((f) => forms(singular).includes(f))).toBe(true);
	});

	// guards: unrelated tables being joined by the wider candidate sets
	it("keeps different tables apart", () => {
		expect(forms("users").some((f) => forms("orders").includes(f))).toBe(false);
		expect(forms("status").some((f) => forms("statistic").includes(f))).toBe(false);
	});

	// guards: the claim check treating `statuses` and `status` as two tables
	it("reports a name claimed twice across the new spellings", () => {
		const toml = `[resources."db.statuses"]\nwriters = []\n\n[resources."db.status"]\nwriters = []\n`;
		expect(errorsOf(toml)).toEqual([`4:1  "status" is already claimed by [resources."db.statuses"]`]);
	});
});
