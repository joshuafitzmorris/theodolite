// Detectors shared by every language: SQL write shapes in strings, and user `match` entries.

import {
	argValue,
	callArgs,
	type FileContext,
	type Hit,
	type Matcher,
	matchClose,
	type Span,
	squash,
	type Tokens,
} from "./tokens.ts";

const SQL_START = /^\s*(?:INSERT|UPDATE|DELETE|WITH|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/;
const SQL_TAG = /(?:^|\.)(?:sql|\$executeRaw|\$queryRaw)(?:Unsafe)?$/;
const SQL_FN = /(?:^|\.)(?:query|execute|executemany|raw|text|\$executeRaw|\$queryRaw)(?:Unsafe)?$/;
/** Positions where the text is SQL by construction, so lowercase keywords count. */
const SQL_CALL = /(?:^|\.)(?:query|execute|executemany|\$executeRaw|\$queryRaw)(?:Unsafe)?$/;

const TG = String.raw`([\w$."\`\[\]{}%]+)`;
const SHAPE_SOURCE = [
	String.raw`\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+${TG}`,
	String.raw`\bUPDATE\s+(?:ONLY\s+)?${TG}\s+(?:(?:AS\s+)?\w+\s+)?SET\b`,
	String.raw`\bDELETE\s+FROM\s+(?:ONLY\s+)?${TG}`,
	String.raw`\bTRUNCATE(?:\s+TABLE)?\s+(?:ONLY\s+)?${TG}`,
	String.raw`\bMERGE\s+INTO\s+${TG}`,
	String.raw`\b(?:ALTER|DROP|CREATE)\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?${TG}`,
];
const SHAPES = SHAPE_SOURCE.map((s) => new RegExp(s, "g"));
const SHAPES_ANY_CASE = SHAPE_SOURCE.map((s) => new RegExp(s, "gi"));
// A keyword at the end of the string, with the table joined on by `+`.
const OPEN_SOURCE = String.raw`\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?|(?:ALTER|DROP|CREATE)\s+TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?)\s*$`;
const OPEN_ENDED = new RegExp(OPEN_SOURCE);
const OPEN_ENDED_ANY_CASE = new RegExp(OPEN_SOURCE, "i");
/** A row lock clause ends in UPDATE but writes nothing. */
const ROW_LOCK = /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\s*$/i;

/** True when a target is a placeholder or interpolation rather than a table name. */
const isDynamic = (x: string) => /[{}%]/.test(x) || /^[$:?]/.test(x);

/** Static last segment of `schema.${x}`-style text, else null. */
function staticTail(x: string): string | null {
	const tail = x.slice(x.lastIndexOf(".") + 1);
	return x.includes(".") && !isDynamic(tail) ? tail : null;
}

export function findSql(t: Tokens, _ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	for (const s of t.strings) {
		if (!(SQL_START.test(s.value) || SQL_TAG.test(s.tag) || SQL_FN.test(s.fn))) continue;
		const anyCase = SQL_TAG.test(s.tag) || SQL_CALL.test(s.fn);
		for (const re of anyCase ? SHAPES_ANY_CASE : SHAPES) {
			for (const m of s.value.matchAll(re)) {
				const raw = m[1] ?? "";
				const tail = isDynamic(raw) ? staticTail(raw) : null;
				const dynamic = tail === null && isDynamic(raw);
				const expr = /\{([^}]*)\}/.exec(raw)?.[1] ?? raw;
				out.push({
					offset: s.bodyStart + m.index,
					via: squash(m[0]),
					target: dynamic ? expr.trim() : (tail ?? raw),
					dynamic,
				});
			}
		}
		const open = ROW_LOCK.test(s.value) ? null : (anyCase ? OPEN_ENDED_ANY_CASE : OPEN_ENDED).exec(s.value);
		const next = /^\s*\+\s*([\w$.]+)/.exec(t.code.slice(s.end, s.end + 200));
		if (open && next) {
			const via = `${squash(open[0])} + ${next[1]}`;
			out.push({ offset: s.bodyStart + open.index, via, target: next[1] ?? "", dynamic: true });
		}
	}
	return out;
}

/** Offsets where a matcher hits `text`. */
export function matchOffsets(m: Matcher, text: string): { at: number; text: string }[] {
	if (m.re) return [...text.matchAll(m.re)].map((x) => ({ at: x.index, text: x[0] }));
	const out: { at: number; text: string }[] = [];
	for (let i = text.indexOf(m.text); i >= 0; i = text.indexOf(m.text, i + m.text.length)) {
		out.push({ at: i, text: m.text });
	}
	return out;
}

const DEFINITION = /(?:\bfunction\*?|\bdef)\s+$/;
const MODIFIERS =
	/^[ \t]*(?:(?:export|default|declare|async|static|public|private|protected|readonly|abstract|override|get|set)\s+)*$/;
const TYPED_PARAM = /^(?:\.\.\.)?[\w$]+\??\s*:|^\{[^}]*\}\s*:/;

/** A declaration of the matched name: `function f(`, `def f(`, a method signature, an interface member. */
function isDefinition(t: Tokens, at: number, text: string): boolean {
	if (DEFINITION.test(t.nc.slice(Math.max(0, at - 16), at))) return true;
	const end = at + text.length;
	const gap = text.endsWith("(") ? null : /^\s*\(/.exec(t.code.slice(end, end + 40));
	const open = text.endsWith("(") ? end - 1 : gap ? end + gap[0].length - 1 : -1;
	const close = open < 0 ? -1 : matchClose(t.code, open);
	if (close < 0) return false;
	const after = t.code.slice(close + 1, close + 200);
	if (/^\s*(?::\s*[A-Za-z_$][^;{}=()?]*)?\{/.test(after)) return true;
	if (callArgs(t.code, open).some(([a, b]) => TYPED_PARAM.test(t.code.slice(a, b)))) return true;
	const lineHead = t.code.slice(t.code.lastIndexOf("\n", at - 1) + 1, at);
	return MODIFIERS.test(lineHead) && /^\s*:/.test(after);
}

export function findMatch(t: Tokens, ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	for (const { resource, matcher } of ctx.matchers) {
		for (const { at, text } of matchOffsets(matcher, t.nc)) {
			if (isDefinition(t, at, text)) continue;
			out.push({ offset: at, via: squash(text), kind: "match", resource, target: text });
		}
	}
	return out;
}

const HOST = /^["'`]?https?:\/\/[\w.-]+/;

/** Hit for an HTTP write. Same-origin relative URLs are not external writes and give null. */
export function httpHit(
	t: Tokens,
	url: Span | undefined,
	base: string,
	receiver: string,
	via: string,
	offset: number,
): Hit | null {
	const v = argValue(t, url);
	const text = base + v.text;
	if (base === "" && (/^\/(?!\/)/.test(text) || text.startsWith("./") || text.startsWith("../"))) return null;
	const dynamic = !(v.literal || HOST.test(text));
	return {
		offset,
		via,
		kind: "http",
		target: text,
		dynamic,
		receiver,
		confidence: v.literal ? "high" : "medium",
	};
}

const JOIN = /^(?:[\w$]+\.)?(?:join|resolve)\s*\(\s*(?=["'])/;

/** Hit for a filesystem write to the path in `dest`. A path.join with a literal head counts as a prefix. */
export function pathHit(t: Tokens, dest: Span | undefined, via: string, offset: number): Hit {
	const v = argValue(t, dest);
	const join = !v.literal && dest ? JOIN.exec(t.source.slice(dest[0], dest[1])) : null;
	const head = join && dest ? t.byQuote.get(dest[0] + join[0].length)?.value : undefined;
	if (head !== undefined) return { offset, via, kind: "fs", target: `${head}/`, confidence: "medium" };
	return {
		offset,
		via,
		kind: "fs",
		target: v.text,
		dynamic: !v.literal,
		confidence: v.literal ? "high" : "medium",
	};
}
