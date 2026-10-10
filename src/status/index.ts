// theodolite status: the Stop and SubagentStop hook. Appends one plain-English line to STATUS.md.
// Hook stdin (hook_event_name, session_id, transcript_path, last_assistant_message, agent_type),
// exit codes and the rule that stdout is context: https://code.claude.com/docs/en/hooks
// This hook never fails: any error exits 0 and writes nothing. It prints nothing to stdout.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TAIL_ENTRIES = 400;

type Json = Record<string, unknown>;

interface Bash {
	id: string;
	command: string;
	ok: boolean | undefined;
}

interface Activity {
	files: string[];
	bash: Bash[];
}

function obj(v: unknown): Json {
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}

function blocks(entry: Json): Json[] {
	const content = obj(entry.message).content;
	return Array.isArray(content) ? content.map(obj) : [];
}

function isHumanPrompt(entry: Json): boolean {
	if (entry.type !== "user") return false;
	const content = obj(entry.message).content;
	if (typeof content === "string") return true;
	const bs = blocks(entry);
	return bs.length > 0 && bs.every((b) => b.type !== "tool_result");
}

// Read the last N JSONL entries, skip unparseable lines, keep only the current turn.
export function parseActivity(jsonl: string): Activity {
	const entries: Json[] = [];
	for (const line of jsonl.split("\n").slice(-TAIL_ENTRIES)) {
		if (!line.trim()) continue;
		try {
			entries.push(obj(JSON.parse(line)));
		} catch {
			// partial line at the cut point or a torn write: ignore
		}
	}
	let start = 0;
	for (let i = entries.length - 1; i >= 0; i--) {
		if (isHumanPrompt(entries[i] as Json)) {
			start = i + 1;
			break;
		}
	}
	const files: string[] = [];
	const bash: Bash[] = [];
	for (const e of entries.slice(start)) {
		for (const b of blocks(e)) {
			if (b.type === "tool_use") {
				const input = obj(b.input);
				if (["Edit", "Write", "MultiEdit"].includes(String(b.name))) {
					const p = input.file_path;
					if (typeof p === "string" && !files.includes(p)) files.push(p);
				} else if (b.name === "Bash" && typeof input.command === "string") {
					bash.push({ id: String(b.id ?? ""), command: input.command, ok: undefined });
				}
			} else if (b.type === "tool_result") {
				const hit = bash.find((x) => x.id === String(b.tool_use_id));
				if (hit) hit.ok = b.is_error !== true;
			}
		}
	}
	return { files, bash };
}

function label(command: string): string {
	const c = command.trim().replace(/\s+/g, " ");
	if (
		/\b(vitest|jest|pytest|mocha)\b|\b(npm|pnpm|yarn|bun) (run )?test\b|go test|cargo test|scripts\/verify/.test(
			c,
		)
	)
		return "tests";
	return c.length > 40 ? `${c.slice(0, 40)}…` : c;
}

function relative(path: string, cwd: string): string {
	return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
}

const QUESTION_WORD =
	/^(?:who|what|when|where|why|which|how|should|shall|can|could|would|will|do|does|did|is|are|may|want|ok|okay)\b/i;

// A question addressed to the reader: the final line ends in "?" outside any URL or code span
// and starts with a question word or mentions "you". A QUESTIONS.md pointer also counts,
// unless the message says there is nothing to add.
export function needsHuman(message: string): boolean {
	const lines = message
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const last = lines[lines.length - 1] ?? "";
	const prose = last
		.replace(/`[^`]*`/g, "")
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, "")
		.trim()
		.replace(/^(?:[-*>]|\d+[.)])\s+/, "");
	if (prose.endsWith("?") && (QUESTION_WORD.test(prose) || /\byou(?:r|rs)?\b/i.test(prose))) return true;
	const withoutNegations = message.replace(/\bnothing (?:new )?(?:to add )?(?:to|for) QUESTIONS\.md\b/gi, "");
	return /QUESTIONS\.md/.test(withoutNegations);
}

function two(n: number): string {
	return String(n).padStart(2, "0");
}

export function stamp(d: Date): string {
	return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export interface Parts {
	prefix: string;
	body: string;
	suffix: string;
}

export function buildParts(input: Json, activity: Activity, now: Date, cwd: string): Parts {
	const who = typeof input.agent_type === "string" && input.agent_type ? input.agent_type : "main";
	const what: string[] = [];
	const n = activity.files.length;
	if (n === 0) what.push("changed no files");
	else {
		const shown = activity.files.slice(0, 2).map((f) => relative(f, cwd));
		if (n > 2) shown.push("…");
		what.push(`edited ${n} file${n === 1 ? "" : "s"} (${shown.join(", ")})`);
	}
	const last = activity.bash[activity.bash.length - 1];
	if (last) {
		const status = last.ok === undefined ? "" : last.ok ? " (ok)" : " (failed)";
		const count = activity.bash.length > 1 ? `${activity.bash.length} commands, last ` : "";
		what.push(`ran ${count}${label(last.command)}${status}`);
	}
	const msg = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
	return {
		prefix: `${stamp(now)}  ${who}  `,
		body: what.join(", "),
		suffix: `  · needs you: ${needsHuman(msg) ? "yes" : "no"}`,
	};
}

export function buildLine(input: Json, jsonl: string, now: Date, cwd: string): string {
	const parts = buildParts(input, parseActivity(jsonl), now, cwd);
	return `${parts.prefix}${parts.body}${parts.suffix}`;
}

// $CLAUDE_PROJECT_DIR when set, else the git root of cwd, else cwd.
export function statusDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
	const fromEnv = env.CLAUDE_PROJECT_DIR;
	if (fromEnv) return fromEnv;
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
	const top = r.status === 0 ? r.stdout.trim() : "";
	return top || cwd;
}

export async function run(_argv: string[]): Promise<number> {
	try {
		const raw = process.stdin.isTTY ? "" : readFileSync(0, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
		const input = parsed as Json;
		// Internal agents report an empty agent_type: not worth a line.
		if (input.hook_event_name === "SubagentStop" && !input.agent_type) return 0;
		let jsonl = "";
		const tp =
			input.hook_event_name === "SubagentStop" && typeof input.agent_transcript_path === "string"
				? input.agent_transcript_path
				: input.transcript_path;
		if (typeof tp === "string") {
			try {
				jsonl = readFileSync(tp, "utf8");
			} catch {
				// transcript missing: fall back to the message alone
			}
		}
		const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
		const line = buildLine(input, jsonl, new Date(), cwd);
		appendFileSync(join(statusDir(cwd), "STATUS.md"), `${line}\n`);
	} catch {
		// never fail the hook
	}
	return 0;
}
