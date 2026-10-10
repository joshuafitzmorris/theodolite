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
	".claude/agents/implement.md",
	".claude/agents/mechanical.md",
	".claude/agents/plan.md",
	".claude/settings.json",
	".github/workflows/theodolite.yml",
	".gitignore",
	"AGENTS.md",
	"CLAUDE.md",
	"theodolite.toml",
];
const version = (
	JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as { version: string }
).version;
const LINE3 = "Rule 1 names `npm run check`";

describe("init", () => {
	// guards: a template missing from the package, or init writing a file outside the three things it promises
	it("writes exactly the expected files", () => {
		const d = tmp();
		const r = init(d);
		expect(r.status).toBe(0);
		expect(all(d).sort()).toEqual(EXPECTED);
		expect(readFileSync(join(d, ".gitignore"), "utf8")).toContain("STATUS.md");
		expect(r.stdout).toMatch(/^create theodolite\.toml$/m);
		expect(r.stdout).toContain("Next:");
	});

	// guards: init clobbering a human-edited config, and --force failing to opt in
	it("skips existing theodolite.toml unless --force", () => {
		const d = tmp();
		writeFileSync(join(d, "theodolite.toml"), "mine\n");
		expect(init(d).stdout).toMatch(/^skip \(exists\) theodolite\.toml$/m);
		expect(readFileSync(join(d, "theodolite.toml"), "utf8")).toBe("mine\n");
		expect(init(d, "--force").stdout).toMatch(/^overwrite theodolite\.toml$/m);
		expect(readFileSync(join(d, "theodolite.toml"), "utf8")).not.toBe("mine\n");
	});

	// guards: the rules block overwriting AGENTS.md, duplicating on re-run, or landing in the wrong file
	it("appends the rules block once, to the right file", () => {
		const d = tmp();
		writeFileSync(join(d, "AGENTS.md"), "# mine\nkeep this");
		const first = init(d);
		expect(first.stdout).toMatch(/^append AGENTS\.md \(## Rules for agents\)$/m);
		const after = readFileSync(join(d, "AGENTS.md"), "utf8");
		expect(after.startsWith("# mine\nkeep this\n\n## Rules for agents\n")).toBe(true);
		const second = init(d, "--force");
		expect(second.stdout).toMatch(/^skip \(exists\) AGENTS\.md: ## Rules for agents$/m);
		expect(readFileSync(join(d, "AGENTS.md"), "utf8")).toBe(after);

		const c = tmp();
		writeFileSync(join(c, "CLAUDE.md"), "# claude\n");
		init(c);
		expect(readFileSync(join(c, "CLAUDE.md"), "utf8")).toContain("## Rules for agents");
		expect(existsSync(join(c, "AGENTS.md"))).toBe(false);

		const n = tmp();
		init(n);
		expect(readFileSync(join(n, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
		expect(readFileSync(join(n, "AGENTS.md"), "utf8")).toContain("## Rules for agents");
	});

	// guards: rule 1 naming a command the repo does not have, and the guidance hiding that
	it("rule 1 names the detected check command", () => {
		const rule1 = (d: string) => readFileSync(join(d, "AGENTS.md"), "utf8");
		const a = tmp();
		writeFileSync(join(a, "package.json"), JSON.stringify({ scripts: { check: "x" } }));
		const ra = init(a);
		expect(rule1(a)).toContain("`npm run check`");
		expect(ra.stdout).not.toContain(LINE3);

		const b = tmp();
		writeFileSync(join(b, "package.json"), JSON.stringify({ scripts: { verify: "x" } }));
		writeFileSync(join(b, "pnpm-lock.yaml"), "");
		init(b);
		expect(rule1(b)).toContain("`pnpm run verify`");

		const c = tmp();
		const rc = init(c);
		expect(rule1(c)).toContain("`npm run check`");
		expect(rc.stdout).toContain(LINE3);
	});

	// guards: unfilled placeholders shipping, GitHub's own ${{ }} syntax being eaten, and a hook pinned to the wrong version
	it("renders every placeholder and keeps GitHub expressions", () => {
		const d = tmp();
		init(d);
		for (const f of EXPECTED.filter((f) => f !== ".gitignore")) {
			expect(readFileSync(join(d, f), "utf8"), f).not.toMatch(/\$\{(project|version|check)\}/);
		}
		expect(readFileSync(join(d, ".github/workflows/theodolite.yml"), "utf8")).toMatch(
			/\$\{\{ github\.base_ref \}\}/,
		);
		expect(readFileSync(join(d, ".claude/settings.json"), "utf8")).toContain(
			`npx theodolite@${version} status`,
		);
	});

	// guards: a subagent prompt growing past what an agent reads in full
	it("subagent templates stay under 15 lines", () => {
		for (const n of ["plan", "implement", "mechanical"]) {
			const text = readFileSync(resolve(import.meta.dirname, `../templates/.claude/agents/${n}.md`), "utf8");
			expect(text.trimEnd().split("\n").length, n).toBeLessThan(15);
		}
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
		expect(r.stdout).toContain("added ask Bash(gh pr merge *)");
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
		expect(r.stdout).toMatch(/^create theodolite\.toml$/m);
		expect(r.stdout).toContain("Next:");
		expect(all(d)).toEqual([]);
	});

	// guards: init writing a config that `check` rejects with exit 2, or writing a matrix for a repo with nothing to declare
	it("template config loads, report output is used on a repo with sources, and no matrix is written without write sites", () => {
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
		const quiet = tmp();
		mkdirSync(join(quiet, "src"));
		writeFileSync(join(quiet, "src/a.ts"), "export const x = 1;\n");
		const r = init(quiet);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/^skip theodolite\.toml \(report found no write sites/m);
		expect(existsSync(join(quiet, "theodolite.toml"))).toBe(false);
		expect(existsSync(join(quiet, ".github/workflows/theodolite.yml"))).toBe(true);
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
