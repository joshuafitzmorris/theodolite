// Python: tokenizer, imports and write-shape detectors.

import { findMatch, findSql, httpHit, pathHit } from "../shared.ts";
import type { FileContext, Hit, ImportRef, Preset, Span, Tokens } from "../tokens.ts";
import { BUILTINS, callArgs, det, lineCol, matchClose, stmtEnd } from "../tokens.ts";
import { tokenizePy } from "./py-lex.ts";

export function parseImportsPy(t: Tokens): ImportRef[] {
	const out: ImportRef[] = [];
	for (const m of t.code.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+([^\n]*)/gm)) {
		out.push({
			spec: m[1] ?? "",
			line: lineCol(t, m.index).line,
			clause: (m[2] ?? "").replace(/[()]/g, ""),
		});
	}
	for (const m of t.code.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm)) {
		for (const spec of (m[1] ?? "").split(",")) {
			out.push({ spec: spec.trim(), line: lineCol(t, m.index).line, clause: "" });
		}
	}
	return out;
}

const last = (x: string) => x.split(".").pop() ?? x;
const opAt = (m: RegExpExecArray) => m.index + m[0].search(/\.[\w]+\s*\($/);
const callText = (m: RegExpExecArray) => m[0].replace(/\s*\($/, "").replace(/\s+/g, "");
const argText = (t: Tokens, s: Span | undefined) => (s ? t.source.slice(s[0], s[1]) : "");
const upper = (x: string) => /^[A-Z]/.test(x);

function sqlalchemyHits(t: Tokens, ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	for (const m of t.code.matchAll(/([\w.]*[sS]ession)\.(add|add_all|delete|merge|bulk_save_objects)\s*\(/g)) {
		ctx.claimed.add(opAt(m));
		const arg = t.source.slice(m.index + m[0].length, m.index + m[0].length + 200);
		const call = /^\s*\[?\s*([\w.]+)\s*\(/.exec(arg)?.[1];
		const name = call ?? /^\s*([\w.]+)/.exec(arg)?.[1];
		if (!name) continue;
		out.push({
			offset: m.index,
			via: `${callText(m)}(${call ? `${last(call)}(` : last(name)}`,
			target: last(name),
			confidence: call ? "medium" : "low",
			construction: m[2] === "add" || m[2] === "add_all",
		});
	}
	// session.query(Model).filter(...).update({...}) and .delete()
	for (const m of t.code.matchAll(/(?<![\w.])[\w.]*(?:[sS]ession|db)\.query\s*\(\s*([A-Za-z_][\w.]*)/g)) {
		const open = m.index + m[0].indexOf("(", m[0].indexOf("query"));
		const close = matchClose(t.code, open);
		const op = close < 0 ? null : chainOps(t.code, close + 1);
		if (!op) continue;
		const model = last(m[1] ?? "");
		out.push({
			offset: m.index,
			via: `query(${model})…${op}`,
			target: model,
			confidence: upper(model) ? "medium" : "low",
		});
	}
	for (const m of t.code.matchAll(
		/(?<![\w.])(?:(?:sa|sqlalchemy|sql)\.)?(insert|update|delete)\s*\(\s*([A-Za-z_][\w.]*)\s*\)/g,
	)) {
		out.push({
			offset: m.index,
			via: `${m[1]}(${m[2]})`,
			target: last(m[2] ?? ""),
			confidence: upper(last(m[2] ?? "")) ? "medium" : "low",
		});
	}
	for (const m of t.code.matchAll(/(?<![\w.])(\w+)\.insert\s*\(\s*\)/g)) {
		out.push({
			offset: m.index,
			via: `${m[1]}.insert()`,
			target: m[1] ?? "",
			receiver: m[1] ?? "",
			confidence: "low",
		});
	}
	return out;
}

/** Offsets of `.update(` / `.delete(` at bracket depth zero in a statement chain. */
function chainOps(code: string, from: number): string | null {
	const stmt = code.slice(from, stmtEnd(code, from));
	let depth = 0;
	for (let i = 0; i < stmt.length; i++) {
		const c = stmt[i] ?? "";
		if ("([{".includes(c)) depth++;
		else if (")]}".includes(c)) depth--;
		else if (c === "." && depth === 0) {
			const op = /^\.(update|delete)\s*\(/.exec(stmt.slice(i));
			if (op) return op[1] ?? "";
		}
	}
	return null;
}

function djangoHits(t: Tokens, ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	for (const m of t.code.matchAll(
		/(\w+)\.objects\.(create|get_or_create|update_or_create|bulk_create|bulk_update)\s*\(/g,
	)) {
		ctx.claimed.add(opAt(m));
		out.push({
			offset: m.index,
			via: callText(m),
			target: m[1] ?? "",
			construction: m[2] === "create" || m[2] === "bulk_create",
		});
	}
	for (const m of t.code.matchAll(/(\w+)\.objects\b/g)) {
		const op = chainOps(t.code, m.index + m[0].length);
		if (op) out.push({ offset: m.index, via: `${m[1]}.objects…${op}`, target: m[1] ?? "" });
	}
	for (const m of t.code.matchAll(/(?<![\w.])(\w+)\.(save|delete)\s*\(/g)) {
		if (ctx.claimed.has(opAt(m)) || BUILTINS.has(m[1] ?? "")) continue;
		out.push({
			offset: m.index,
			via: callText(m),
			target: m[1] ?? "",
			receiver: m[1] ?? "",
			confidence: "low",
		});
	}
	return out;
}

const isNames = (v: unknown): v is Set<string> =>
	v instanceof Set && [...v].every((x) => typeof x === "string");
const WRITE_START = /^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i;

/** Names assigned a string literal that starts with a write keyword, anywhere in the file. */
function writeStrings(t: Tokens, ctx: FileContext): ReadonlySet<string> {
	const hit = ctx.cache.get("write-strings");
	if (isNames(hit)) return hit;
	const names = new Set<string>();
	for (const m of t.code.matchAll(
		/(?<![\w.])([A-Za-z_][\w.]*)\s*(?::[^=\n]+)?=(?!=)\s*[rRbBfFuU]{0,2}(?=["'])/g,
	)) {
		const s = t.byQuote.get(m.index + m[0].length);
		if (s && WRITE_START.test(s.value)) names.add(m[1] ?? "");
	}
	ctx.cache.set("write-strings", names);
	return names;
}

/**
 * `cur.execute(sql)` with the statement in a variable. It is a write only when the variable is an alias the
 * config declares or is bound in this file to a string that starts with a write keyword; otherwise the call
 * is as likely a SELECT, a job executor or a task queue.
 */
function dbapiHits(t: Tokens, ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	const bound = writeStrings(t, ctx);
	for (const m of t.code.matchAll(/([\w.]+)\.(execute|executemany)\s*\(/g)) {
		if (/session$/i.test(m[1] ?? "")) continue;
		const arg = argText(t, callArgs(t.code, m.index + m[0].length - 1)[0]);
		if (/^[A-Za-z_][\w.]*$/.test(arg) && (bound.has(arg) || ctx.aliases.has(arg))) {
			out.push({ offset: m.index, via: `${callText(m)}(${arg})`, target: arg, dynamic: true });
		}
	}
	return out;
}

interface Binds {
	http: Map<string, string>;
}

const isBinds = (v: unknown): v is Binds => typeof v === "object" && v !== null && "http" in v;

function bindings(t: Tokens, ctx: FileContext): Binds {
	const hit = ctx.cache.get("binds");
	if (isBinds(hit)) return hit;
	const http = new Map([
		["requests", ""],
		["httpx", ""],
	]);
	const re =
		/(?:(\w+)\s*=\s*)?(?:requests\.Session|httpx\.(?:Async)?Client)\s*\(([^)]*)\)(?:\s*as\s+(\w+))?/g;
	for (const m of t.code.matchAll(re)) {
		const name = m[1] ?? m[3];
		if (!name) continue;
		const base = /base_url\s*=\s*(?=["'])/.exec(m[2] ?? "");
		const at = m.index + m[0].indexOf("(") + 1 + (base ? base.index + base[0].length : 0);
		http.set(name, base ? (t.byQuote.get(at)?.value ?? "") : "");
	}
	const b = { http };
	ctx.cache.set("binds", b);
	return b;
}

function httpHits(t: Tokens, ctx: FileContext): Hit[] {
	const { http } = bindings(t, ctx);
	const out: Hit[] = [];
	const add = (h: Hit | null) => h && out.push(h);
	for (const m of t.code.matchAll(/(?<![\w.])(\w+)\.(post|put|patch|delete)\s*\(/g)) {
		const base = http.get(m[1] ?? "");
		if (base === undefined) continue;
		ctx.claimed.add(opAt(m));
		add(httpHit(t, callArgs(t.code, m.index + m[0].length - 1)[0], base, m[1] ?? "", callText(m), m.index));
	}
	for (const m of t.code.matchAll(/(?<![\w.])(\w+)\.request\s*\(\s*(?=["'])/g)) {
		const base = http.get(m[1] ?? "");
		const verb = t.byQuote.get(m.index + m[0].length)?.value.toUpperCase() ?? "";
		if (base === undefined || !/^(?:POST|PUT|PATCH|DELETE)$/.test(verb)) continue;
		const args = callArgs(t.code, m.index + m[0].lastIndexOf("("));
		add(httpHit(t, args[1], base, m[1] ?? "", `${m[1]}.request ${verb}`, m.index));
	}
	return out;
}

function fsHits(t: Tokens, _ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	for (const m of t.code.matchAll(/(?<![\w.])open\s*\(/g)) {
		const open = m.index + m[0].length - 1;
		const args = callArgs(t.code, open);
		const inline = args[1] ? t.byQuote.get(args[1][0]) : undefined;
		const kw = /\bmode\s*=\s*(?=["'])/.exec(t.code.slice(open, matchClose(t.code, open)));
		const mode = inline?.value ?? (kw ? t.byQuote.get(open + kw.index + kw[0].length)?.value : undefined);
		if (mode && /[wax+]/.test(mode)) out.push(pathHit(t, args[0], `open(…, "${mode}")`, m.index));
	}
	for (const m of t.code.matchAll(/(?<![\w.])Path\s*\(/g)) {
		const open = m.index + m[0].length - 1;
		const close = matchClose(t.code, open);
		const tail =
			/^((?:\s*\/\s*(?:["'][^"'\n]*["']|\w+))*)\s*\)?\s*\.(write_text|write_bytes|unlink|mkdir|rename|touch)\s*\(/.exec(
				t.code.slice(close + 1, close + 300),
			);
		if (close < 0 || !tail) continue;
		const hit = pathHit(t, callArgs(t.code, open)[0], `Path(…).${tail[2]}`, m.index);
		const parts = [
			...t.source.slice(close + 1, close + 1 + (tail[1] ?? "").length).matchAll(/\/\s*(["'])(.*?)\1/g),
		];
		if (!hit.dynamic && parts.length > 0)
			hit.target = [hit.target, ...parts.map((x) => x[2])].join("/").replace(/\/+/g, "/");
		out.push(hit);
	}
	for (const m of t.code.matchAll(
		/(?<![\w.])(shutil|os)\.(copy|copyfile|copytree|move|rmtree|remove|unlink|rmdir|makedirs|rename|replace)\s*\(/g,
	)) {
		const ok =
			m[1] === "shutil"
				? /^(?:copy|copyfile|copytree|move|rmtree)$/
				: /^(?:remove|unlink|rmdir|makedirs|rename|replace)$/;
		if (!ok.test(m[2] ?? "")) continue;
		const args = callArgs(t.code, m.index + m[0].length - 1);
		const two = /^(?:copy|copyfile|copytree|move|rename|replace)$/.test(m[2] ?? "");
		out.push(pathHit(t, two ? args[1] : args[0], callText(m), m.index));
	}
	return out;
}

export const py: Preset = {
	language: "py",
	extensions: [".py"],
	anchor:
		/INSERT|UPDATE|DELETE|TRUNCATE|MERGE|ALTER|DROP|CREATE|\.(?:add|add_all|delete|merge|save|insert|update|objects|execute|post|put|patch|request)|insert|update|delete|bulk|open|Path|shutil|os\.|create_engine|sessionmaker|connect|MongoClient|create_pool/i,
	tokenize: tokenizePy,
	parseImports: parseImportsPy,
	connectionDefaults: [
		{ pattern: String.raw`(?<![\w.])create_engine\s*\(`, module: "^sqlalchemy" },
		{ pattern: String.raw`(?<![\w.])sessionmaker\s*\(`, module: "^sqlalchemy" },
		{ pattern: String.raw`psycopg\.connect\s*\(`, module: "^psycopg$" },
		{ pattern: String.raw`psycopg2\.connect\s*\(`, module: "^psycopg2" },
		{ pattern: String.raw`asyncpg\.create_pool\s*\(`, module: "^asyncpg$" },
		{ pattern: String.raw`sqlite3\.connect\s*\(`, module: "^sqlite3$" },
		{ pattern: String.raw`(?<![\w.])MongoClient\s*\(`, module: "^pymongo" },
	],
	detectors: [
		det("sql", "high", false, findSql),
		det("http", "high", false, httpHits),
		det("sqlalchemy", "medium", true, sqlalchemyHits, true),
		det("django", "medium", true, djangoHits),
		det("dbapi", "high", false, dbapiHits),
		det("fs", "high", false, fsHits),
		det("match", "high", false, findMatch),
	],
};
