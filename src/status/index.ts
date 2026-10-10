// theodolite status: the Stop and SubagentStop hook. When the agent's final message asks the human a
// question, appends one line (time, branch, question, the default taken) to a STATUS.md shared by every
// git worktree of the repository. Messages that ask nothing write nothing.
// Hook stdin (hook_event_name, cwd, last_assistant_message, agent_type), exit codes and the rule that
// stdout is context: https://code.claude.com/docs/en/hooks
// This hook never fails: any error exits 0 and writes nothing. It prints nothing to stdout.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

type Json = Record<string, unknown>;

const QUESTION_WORD =
	/^(?:who|what|when|where|why|which|how|should|shall|can|could|would|will|do|does|did|is|are|may|want|ok|okay)\b/i;

function finalLine(message: string): string {
	const lines = message
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	return (lines[lines.length - 1] ?? "").replace(/^(?:[-*>]|\d+[.)])\s+/, "");
}

// A question addressed to the reader: the final line ends in "?" outside any URL or code span
// and starts with a question word or mentions "you".
export function needsHuman(message: string): boolean {
	const prose = finalLine(message)
		.replace(/`[^`]*`/g, "")
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, "")
		.trim();
	return prose.endsWith("?") && (QUESTION_WORD.test(prose) || /\byou(?:r|rs)?\b/i.test(prose));
}

function cut(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

// The rest of the line after the last "default:", "default is" or "defaulting to".
function defaultTaken(message: string): string {
	const hits = [...message.matchAll(/default:|default is|defaulting to/gi)];
	const hit = hits[hits.length - 1];
	if (!hit) return "not stated";
	const rest = message.slice(hit.index + hit[0].length).split("\n")[0] ?? "";
	return cut(rest.trim(), 120) || "not stated";
}

function two(n: number): string {
	return String(n).padStart(2, "0");
}

export function stamp(d: Date): string {
	return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function git(cwd: string, args: string[]): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	return r.status === 0 ? r.stdout.trim() : "";
}

export function currentBranch(cwd: string): string {
	return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || basename(cwd);
}

export function buildLine(input: Json, now: Date, cwd: string, branch = currentBranch(cwd)): string {
	const message = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
	const agent = typeof input.agent_type === "string" && input.agent_type ? `${input.agent_type}  ` : "";
	const question = cut(finalLine(message), 160);
	return `${stamp(now)}  ${branch}  ${agent}${question}  default: ${defaultTaken(message)}`;
}

// The parent of the repository's common .git directory (the main worktree root), so every linked
// worktree shares one STATUS.md. Without git: $CLAUDE_PROJECT_DIR, then cwd.
export function statusRoot(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
	const common = git(cwd, ["rev-parse", "--git-common-dir"]);
	return common ? dirname(resolve(cwd, common)) : env.CLAUDE_PROJECT_DIR || cwd;
}

export async function run(_argv: string[]): Promise<number> {
	try {
		const raw = process.stdin.isTTY ? "" : readFileSync(0, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
		const input = parsed as Json;
		// Internal agents report an empty agent_type: not worth a line.
		if (input.hook_event_name === "SubagentStop" && !input.agent_type) return 0;
		const message = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
		if (!needsHuman(message)) return 0;
		const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
		appendFileSync(join(statusRoot(cwd), "STATUS.md"), `${buildLine(input, new Date(), cwd)}\n`);
	} catch {
		// never fail the hook
	}
	return 0;
}
