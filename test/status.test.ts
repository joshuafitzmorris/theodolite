import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLine, needsHuman } from "../src/status/index.ts";

const fx = resolve(import.meta.dirname, "fixtures/hooks");
const transcript = readFileSync(join(fx, "transcript.jsonl"), "utf8");
const load = (name: string) => JSON.parse(readFileSync(join(fx, name), "utf8")) as Record<string, unknown>;
const now = new Date(2026, 9, 10, 14, 2);
const cli = resolve(import.meta.dirname, "../src/cli.ts");

describe("status", () => {
	// guards: the line format drifting, which breaks anything that reads STATUS.md
	it("builds the exact line from a hook payload and transcript", () => {
		expect(buildLine(load("stop.json"), transcript, now, "/work/app")).toBe(
			"2026-10-10 14:02  main  edited 3 files (src/parse.ts, src/lex.ts, …), ran tests (ok)  · needs you: no",
		);
	});

	// guards: a trailing question being missed, so the human never learns an agent is waiting
	it("flags needs you on a trailing question and names the subagent", () => {
		const line = buildLine(load("stop-question.json"), transcript, now, "/work/app");
		expect(line).toContain("  implement  ");
		expect(line.endsWith("· needs you: yes")).toBe(true);
		expect(needsHuman("Done.\nSee QUESTIONS.md")).toBe(true);
		expect(needsHuman("Is this right? I think so.\nDone.")).toBe(false);
	});

	// guards: a malformed payload failing the hook or writing a junk line
	it("exits 0 and writes nothing on malformed input", () => {
		const dir = mkdtempSync(join(tmpdir(), "wm-status-"));
		for (const input of ["{not json", "", "[]"]) {
			const r = spawnSync("node", [cli, "status"], { cwd: dir, input, encoding: "utf8" });
			expect(r.status).toBe(0);
			expect(r.stdout).toBe("");
		}
		expect(existsSync(join(dir, "STATUS.md"))).toBe(false);
	});

	// guards: false "needs you" from URLs, code spans, statements and the "nothing to add" line
	it("needs-you heuristic ignores non-questions", () => {
		expect(needsHuman("Nothing to add to QUESTIONS.md.")).toBe(false);
		expect(needsHuman("See https://example.com/a?b=1")).toBe(false);
		expect(needsHuman("Run `foo?` to check")).toBe(false);
		expect(needsHuman("Is the schema right?")).toBe(true);
		expect(needsHuman("The build is green, right?")).toBe(false);
		expect(needsHuman("Done. Anything else you want?")).toBe(true);
	});

	// guards: SubagentStop reading the wrong transcript, logging internal agents, writing STATUS.md in cwd
	it("handles SubagentStop transcripts, empty agent_type and the STATUS.md location", () => {
		const dir = mkdtempSync(join(tmpdir(), "wm-status-"));
		const proj = join(dir, "proj");
		mkdirSync(proj);
		writeFileSync(join(dir, "agent.jsonl"), transcript);
		writeFileSync(join(dir, "main.jsonl"), "");
		const run = (payload: Record<string, unknown>) =>
			spawnSync("node", [cli, "status"], {
				cwd: dir,
				input: JSON.stringify({ cwd: dir, ...payload }),
				encoding: "utf8",
				env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
			});
		run({ hook_event_name: "SubagentStop", agent_type: "", transcript_path: join(dir, "main.jsonl") });
		expect(existsSync(join(proj, "STATUS.md"))).toBe(false);
		const r = run({
			hook_event_name: "SubagentStop",
			agent_type: "implement",
			transcript_path: join(dir, "main.jsonl"),
			agent_transcript_path: join(dir, "agent.jsonl"),
		});
		expect(r.status).toBe(0);
		expect(existsSync(join(dir, "STATUS.md"))).toBe(false);
		const line = readFileSync(join(proj, "STATUS.md"), "utf8");
		expect(line).toContain("  implement  edited 3 files");
	});
});
