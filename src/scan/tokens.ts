// Shared types and text helpers for the scanner. No detection rules live here.

export type Confidence = "high" | "medium" | "low";
export type Lang = "ts" | "py";
export type SiteKind = "db" | "http" | "fs" | "match" | "new";
export type Span = [start: number, end: number];
/** A region to blank: start, end, and whether it is a comment (blanked in both views). */
export type Ev = [start: number, end: number, comment: boolean];

/** A string literal. Offsets index the original source; `value` is the raw text between the delimiters. */
export type Str = {
	start: number;
	quote: number;
	bodyStart: number;
	bodyEnd: number;
	end: number;
	value: string;
	interp: boolean;
	/** Tag chain of a tagged template, else "". */
	tag: string;
	/** Callee chain when the literal is the first argument of a call, else "". */
	fn: string;
};

/** `code` blanks comments and string bodies; `nc` blanks only comments. Both keep every offset. */
export type Tokens = {
	source: string;
	code: string;
	nc: string;
	strings: Str[];
	byQuote: Map<number, Str>;
	lineStarts: number[];
};

export type ImportRef = { spec: string; line: number; clause: string };
export type Matcher = { text: string; re: RegExp | null };

export type FileContext = {
	path: string;
	aliases: ReadonlySet<string>;
	matchers: { resource: string; matcher: Matcher }[];
	imports: ImportRef[];
	cache: Map<string, unknown>;
	/** Offsets of calls an earlier detector already reported. */
	claimed: Set<number>;
};

/** What a detector returns; the runner fills the rest from the detector entry. */
export type Hit = {
	offset: number;
	via: string;
	kind?: SiteKind;
	target?: string;
	dynamic?: boolean;
	receiver?: string;
	resource?: string;
	confidence?: Confidence;
	construction?: boolean;
	dropIfUnresolved?: boolean;
};
export type Site = Required<Hit> & { family: string };

export type Detector = {
	family: string;
	confidence: Confidence;
	construction: boolean;
	dropIfUnresolved: boolean;
	find(t: Tokens, ctx: FileContext): Hit[];
};

export type Preset = {
	language: Lang;
	extensions: string[];
	/** A file that fails this cheap test cannot contain a site. */
	anchor: RegExp;
	tokenize(source: string, path: string): Tokens;
	parseImports(t: Tokens): ImportRef[];
	connectionDefaults: { pattern: string; module: string }[];
	detectors: Detector[];
};

export const det = (
	family: string,
	confidence: Confidence,
	dropIfUnresolved: boolean,
	find: Detector["find"],
	construction = false,
): Detector => ({ family, confidence, construction, dropIfUnresolved, find });

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** Build the views from blank events given in source order. */
export function buildTokens(source: string, ev: Ev[], strings: Str[]): Tokens {
	const views: { code: string[]; nc: string[] } = { code: [], nc: [] };
	const last = { code: 0, nc: 0 };
	for (const [s, e, comment] of ev) {
		for (const v of comment ? (["code", "nc"] as const) : (["code"] as const)) {
			if (e <= s || s < last[v]) continue;
			views[v].push(source.slice(last[v], s), blank(source.slice(s, e)));
			last[v] = e;
		}
	}
	const lineStarts = [0];
	for (let i = source.indexOf("\n"); i >= 0; i = source.indexOf("\n", i + 1)) lineStarts.push(i + 1);
	const code = [...views.code, source.slice(last.code)].join("");
	const nc = [...views.nc, source.slice(last.nc)].join("");
	return { source, code, nc, strings, byQuote: new Map(strings.map((s) => [s.quote, s])), lineStarts };
}

export function lineCol(t: Tokens, offset: number): { line: number; col: number } {
	let lo = 0;
	let hi = t.lineStarts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if ((t.lineStarts[mid] ?? 0) <= offset) lo = mid;
		else hi = mid - 1;
	}
	return { line: lo + 1, col: offset - (t.lineStarts[lo] ?? 0) + 1 };
}

/** The dotted identifier chain that ends just before `end`. */
export function chainBefore(src: string, end: number): string {
	let b = end;
	while (b > 0 && /[\w$.?]/.test(src[b - 1] ?? "")) b--;
	return src.slice(b, end).replace(/\?/g, "");
}

/** Callee chain when a literal starting at `start` is the first argument of a call. */
export function calleeBefore(src: string, start: number): string {
	const prev = (i: number) => {
		while (i > 0 && /\s/.test(src[i - 1] ?? "")) i--;
		return i;
	};
	const open = prev(start);
	return src[open - 1] === "(" ? chainBefore(src, prev(open - 1)) : "";
}

/** Index of the bracket closing the one at `open`, or -1. */
export function matchClose(code: string, open: number): number {
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		if ("([{".includes(code[i] ?? "")) depth++;
		else if (")]}".includes(code[i] ?? "") && --depth === 0) return i;
	}
	return -1;
}

/** Top-level argument spans of the call whose `(` is at `open`, trimmed; empty when unbalanced. */
export function callArgs(code: string, open: number): Span[] {
	const close = matchClose(code, open);
	const out: Span[] = [];
	let depth = 0;
	let from = open + 1;
	const push = (to: number) => {
		const text = code.slice(from, to);
		const s = from + text.length - text.trimStart().length;
		if (to - (text.length - text.trimEnd().length) > s)
			out.push([s, to - (text.length - text.trimEnd().length)]);
		from = to + 1;
	};
	for (let i = open + 1; i < close; i++) {
		if ("([{".includes(code[i] ?? "")) depth++;
		else if (")]}".includes(code[i] ?? "")) depth--;
		else if (code[i] === "," && depth === 0) push(i);
	}
	if (close >= 0) push(close);
	return out;
}

/** End of the statement that starts at `from`, following method chains onto later lines. */
export function stmtEnd(code: string, from: number): number {
	let depth = 0;
	const limit = Math.min(code.length, from + 3000);
	for (let i = from; i < limit; i++) {
		const c = code[i] ?? "";
		if ("([{".includes(c)) depth++;
		else if (")]}".includes(c) && --depth < 0) return i;
		else if (
			(c === ";" && depth === 0) ||
			(c === "\n" && depth === 0 && !/^\s*\??\./.test(code.slice(i, i + 200)))
		) {
			return i;
		}
	}
	return limit;
}

/** A pure string literal gives its body; anything else gives the raw expression text. */
export function argValue(t: Tokens, span: Span | undefined): { text: string; literal: boolean } {
	if (!span) return { text: "", literal: false };
	const str = t.byQuote.get(span[0]);
	if (str && str.end === span[1]) return { text: str.value, literal: !str.interp };
	return { text: t.source.slice(span[0], span[1]), literal: false };
}

/** Collapse whitespace so `via` text stays on one line. */
export const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export const BUILTINS = new Set(
	"Object Map Set WeakMap WeakSet Promise Array JSON Math Reflect Symbol Number String Date Intl Buffer process window document console URLSearchParams Headers FormData dict list set str int os sys json self cls params".split(
		" ",
	),
);
