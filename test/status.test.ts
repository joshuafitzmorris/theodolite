import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLine, needsHuman } from "../src/status/index.ts";

const fx = resolve(import.meta.dirname, "fixtures/hooks");
const load = (name: string) => JSON.parse(readFileSync(join(fx, name), "utf8")) as Record<string, unknown>;
const now = new Date(2026, 9, 10, 14, 2);
const cli = resolve(import.meta.dirname, "../src/cli.ts");

function hook(cwd: string, payload: Record<string, unknown>) {
	return spawnSync("node", [cli, "status"], {
		cwd,
		input: JSON.stringify({ cwd, ...payload }),
		encoding: "utf8",
	});
}

function git(cwd: string, ...args: string[]) {
	const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
		cwd,
		encoding: "utf8",
	});
	expect(r.status).toBe(0);
}

describe("status", () => {
	// guards: the line format drifting, which breaks anything that reads STATUS.md
	it("builds the exact line from a question and its stated default", () => {
		expect(buildLine(load("stop-question.json"), now, "/work/app", "feature-x")).toBe(
			"2026-10-10 14:02  feature-x  Should I run the migration now?  default: not run; the migration waits for you.",
		);
	});

	// guards: a message with no question producing a line, or a malformed payload failing the hook
	it("writes nothing when no question is asked or the input is malformed", () => {
		const dir = mkdtempSync(join(tmpdir(), "wm-status-"));
		for (const input of ["{not json", "", "[]", JSON.stringify(load("stop.json"))]) {
			const r = spawnSync("node", [cli, "status"], { cwd: dir, input, encoding: "utf8" });
			expect(r.status).toBe(0);
			expect(r.stdout).toBe("");
		}
		expect(existsSync(join(dir, "STATUS.md"))).toBe(false);
	});

	// guards: false "needs you" from URLs, code spans and statements, or a real question being missed
	it("needs-you heuristic ignores non-questions", () => {
		expect(needsHuman("See https://example.com/a?b=1")).toBe(false);
		expect(needsHuman("Run `foo?` to check")).toBe(false);
		expect(needsHuman("The build is green, right?")).toBe(false);
		expect(needsHuman("Is the schema right?")).toBe(true);
		expect(needsHuman("Done. Anything else you want?")).toBe(true);
	});

	// guards: each worktree keeping its own STATUS.md, empty agent_type being logged, subagent name lost
	it("writes one STATUS.md in the main repo for every worktree", () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "wm-status-")));
		const main = join(dir, "main");
		const wt = join(dir, "wt");
		spawnSync("git", ["init", "-q", main]);
		git(main, "commit", "-q", "--allow-empty", "-m", "init");
		git(main, "worktree", "add", "-q", wt, "-b", "wt");
		const message = "Default: kept.\nShould I go on?";
		hook(wt, { hook_event_name: "SubagentStop", agent_type: "", last_assistant_message: message });
		expect(existsSync(join(main, "STATUS.md"))).toBe(false);
		const r = hook(wt, {
			hook_event_name: "SubagentStop",
			agent_type: "implement",
			last_assistant_message: message,
		});
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("");
		expect(existsSync(join(wt, "STATUS.md"))).toBe(false);
		expect(readFileSync(join(main, "STATUS.md"), "utf8")).toContain(
			"  wt  implement  Should I go on?  default: kept.",
		);
	});
});
