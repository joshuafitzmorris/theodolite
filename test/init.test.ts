import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cli = resolve(import.meta.dirname, "../src/cli.ts");
const tmp = () => mkdtempSync(join(tmpdir(), "wm-init-"));
const init = (root: string, ...flags: string[]) =>
	spawnSync("node", [cli, "init", "--root", root, ...flags], { encoding: "utf8" });
const all = (d: string, b = ""): string[] =>
	readdirSync(join(d, b)).flatMap((n) => {
		const r = b ? `${b}/${n}` : n;
		return statSync(join(d, r)).isDirectory() ? all(d, r) : [r];
	});

const EXPECTED = [
	"AGENTS.md",
	"CLAUDE.md",
	"theodolite.toml",
	".claude/settings.json",
	".claude/agents/plan.md",
	".claude/agents/implement.md",
	".claude/agents/mechanical.md",
	".github/workflows/theodolite.yml",
	".gitignore",
];

describe("init", () => {
	// guards: a template missing from the package, or an unfilled placeholder shipping
	it("writes every file and the gitignore entry", () => {
		const d = tmp();
		const r = init(d);
		expect(r.status).toBe(0);
		for (const f of EXPECTED) expect(existsSync(join(d, f)), f).toBe(true);
		expect(readFileSync(join(d, ".gitignore"), "utf8")).toContain("STATUS.md");
		expect(r.stdout).toMatch(/^create AGENTS\.md$/m);
	});

	// guards: init clobbering a human-edited file, and --force failing to opt in
	it("skips existing files unless --force", () => {
		const d = tmp();
		writeFileSync(join(d, "AGENTS.md"), "mine\n");
		const r = init(d);
		expect(r.stdout).toMatch(/^skip \(exists\) AGENTS\.md$/m);
		expect(readFileSync(join(d, "AGENTS.md"), "utf8")).toBe("mine\n");
		expect(init(d, "--force").stdout).toMatch(/^overwrite AGENTS\.md$/m);
		expect(readFileSync(join(d, "AGENTS.md"), "utf8")).not.toBe("mine\n");
	});

	// guards: merging dropping the user's own rules or hooks
	it("merges settings.json without removing anything", () => {
		const d = tmp();
		mkdirSync(join(d, ".claude"));
		const mine = {
			model: "sonnet",
			permissions: { allow: ["Bash(ls:*)"], deny: ["Edit(secrets/**)", "Edit(AGENTS.md)"] },
			hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] },
		};
		writeFileSync(join(d, ".claude/settings.json"), JSON.stringify(mine));
		const r = init(d);
		expect(r.stdout).toContain("added ask Bash(git push *)");
		expect(r.stdout).not.toContain("added deny Edit(AGENTS.md)");
		const s = JSON.parse(readFileSync(join(d, ".claude/settings.json"), "utf8"));
		expect(s.model).toBe("sonnet");
		expect(s.permissions.allow).toEqual(["Bash(ls:*)"]);
		expect(s.permissions.deny).toEqual(expect.arrayContaining(["Edit(secrets/**)", "Edit(.env*)"]));
		expect(s.hooks.Stop).toHaveLength(2);
		expect(s.hooks.SubagentStop).toHaveLength(1);
		expect(init(d).stdout).toMatch(/^skip \(exists\) \.claude\/settings\.json$/m);
	});

	// guards: --dry-run touching the disk
	it("--dry-run writes nothing", () => {
		const d = tmp();
		const r = init(d, "--dry-run");
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/^create AGENTS\.md$/m);
		expect(all(d)).toEqual([]);
	});

	// guards: init writing a config that `check` rejects with exit 2 (bad kind, undeclared grandfathered resource, empty include)
	it("template config loads, and report output is used on a repo with sources", () => {
		const check = (root: string) => spawnSync("node", [cli, "check", "--root", root], { encoding: "utf8" });
		const empty = tmp();
		init(empty);
		expect(check(empty).status).not.toBe(2);
		const d = tmp();
		mkdirSync(join(d, "src"));
		writeFileSync(join(d, "src/a.ts"), "await prisma.user.create({});\n");
		expect(init(d).status).toBe(0);
		const toml = readFileSync(join(d, "theodolite.toml"), "utf8");
		expect(toml).not.toContain("effects.email");
		expect(check(d).status).not.toBe(2);
	});

	// guards: unreadable settings.json exiting 0 as if the merge had worked
	it("exits 1 with the parse error on invalid settings.json", () => {
		const d = tmp();
		mkdirSync(join(d, ".claude"));
		writeFileSync(join(d, ".claude/settings.json"), "{not json");
		const r = init(d);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain(".claude/settings.json");
		expect(readFileSync(join(d, ".claude/settings.json"), "utf8")).toBe("{not json");
	});

	// guards: a non-array permissions.deny or ask being overwritten
	it("leaves non-array deny and ask untouched and warns", () => {
		const d = tmp();
		mkdirSync(join(d, ".claude"));
		writeFileSync(
			join(d, ".claude/settings.json"),
			JSON.stringify({ permissions: { deny: "Edit(x)", ask: { a: 1 } } }),
		);
		const r = init(d);
		expect(r.status).toBe(0);
		expect(r.stderr).toMatch(/permissions\.deny is not an array/);
		expect(r.stderr).toMatch(/permissions\.ask is not an array/);
		const s = JSON.parse(readFileSync(join(d, ".claude/settings.json"), "utf8"));
		expect(s.permissions.deny).toBe("Edit(x)");
		expect(s.permissions.ask).toEqual({ a: 1 });
	});
});
