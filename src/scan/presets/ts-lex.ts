// TypeScript and JavaScript tokenizer: comments, strings, templates with nested `${}`, regex literals.

import { buildTokens, calleeBefore, chainBefore, type Ev, type Str, type Tokens } from "../tokens.ts";

const WORD = /[\w$]/;
const REGEX_AFTER = new Set("(,=:[!&|?{;+-*%^~".split(""));
const REGEX_KEYWORDS = /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|yield|await|else|do)$/;

const JSX_FILE = /\.[jt]sx$/;
const TAG_NAME = /[\w$.:-]/;

export function tokenizeTs(source: string, path = ""): Tokens {
	const jsx = JSX_FILE.test(path);
	const n = source.length;
	const ev: Ev[] = [];
	const strings: Str[] = [];
	let i = 0;
	let prev = "";
	let prevAt = -1;

	const regexAllowed = () =>
		prev === "" ||
		REGEX_AFTER.has(prev) ||
		(prev === ">" && source[prevAt - 1] === "=") ||
		(WORD.test(prev) && REGEX_KEYWORDS.test(source.slice(Math.max(0, prevAt - 10), prevAt + 1)));

	const push = (quote: number, bodyStart: number, bodyEnd: number, interp: boolean, tpl: boolean) => {
		strings.push({
			start: quote,
			quote,
			bodyStart,
			bodyEnd,
			end: bodyEnd + 1,
			value: source.slice(bodyStart, bodyEnd),
			interp,
			tag: tpl && WORD.test(source[quote - 1] ?? "") ? chainBefore(source, quote) : "",
			fn: calleeBefore(source, quote),
		});
	};

	const template = () => {
		const quote = i;
		let seg = i + 1;
		let j = i + 1;
		let interp = false;
		while (j < n && source[j] !== "`") {
			if (source[j] === "\\") j += 2;
			else if (source[j] === "$" && source[j + 1] === "{") {
				interp = true;
				ev.push([seg, j, false]);
				i = j + 2;
				code(true);
				j = i + 1;
				seg = j;
			} else j++;
		}
		ev.push([seg, j, false]);
		push(quote, quote + 1, j, interp, true);
		i = j + 1;
	};

	const regex = () => {
		let j = i + 1;
		let inClass = false;
		for (; j < n && source[j] !== "\n"; j++) {
			const c = source[j];
			if (c === "\\") j++;
			else if (c === "[") inClass = true;
			else if (c === "]") inClass = false;
			else if (c === "/" && !inClass) break;
		}
		if (source[j] !== "/" || j === i + 1) return false;
		ev.push([i + 1, j, false]);
		i = j + 1;
		return true;
	};

	/**
	 * A JSX element starting at `<`. Text between tags is blanked in both views so a `/*`, a backtick or a
	 * quote in it opens nothing. Returns false and leaves no trace when the text is not an element, as in
	 * a generic arrow function `<T,>(x) => x`.
	 */
	const element = (): boolean => {
		const start = i;
		const marks = [ev.length, strings.length];
		const give = () => {
			ev.length = marks[0] ?? 0;
			strings.length = marks[1] ?? 0;
			i = start;
			return false;
		};
		const expression = () => {
			i++;
			prev = "{";
			prevAt = i - 1;
			code(true);
			i++;
		};
		if (!/[A-Za-z_$>]/.test(source[i + 1] ?? "")) return false;
		i++;
		while (TAG_NAME.test(source[i] ?? "")) i++;
		for (;;) {
			const c = source[i] ?? "";
			if (c === "") return give();
			if (c === "{") expression();
			else if (c === '"' || c === "'") {
				const end = source.indexOf(c, i + 1);
				if (end < 0) return give();
				ev.push([i + 1, end, false]);
				i = end + 1;
			} else if (c === "/" && source[i + 1] === ">") {
				i += 2;
				return true;
			} else if (c === ">") {
				i++;
				break;
			} else if (/[\s\w$:.=-]/.test(c)) i++;
			else return give();
		}
		const head = source.slice(start, i);
		if (/^\s*\(/.test(source.slice(i, i + 40)) && (/^<[A-Z]>$/.test(head) || /\sextends\s/.test(head))) {
			return give();
		}
		for (let text = i; ; ) {
			const next = text < source.length ? source.slice(text).search(/[<{]/) : -1;
			const at = next < 0 ? n : text + next;
			ev.push([text, at, true]);
			i = at;
			if (at >= n) return true;
			if (source[at] === "{") {
				expression();
				text = i;
			} else if (source[at + 1] === "/") {
				const close = source.indexOf(">", at);
				i = close < 0 ? n : close + 1;
				return true;
			} else if (element()) text = i;
			else {
				i = at + 1;
				text = i;
			}
		}
	};

	function code(stop: boolean) {
		let depth = 0;
		while (i < n) {
			const c = source[i] ?? "";
			if (c === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
				const line = source[i + 1] === "/";
				const at = line ? source.indexOf("\n", i) : source.indexOf("*/", i + 2);
				const end = at < 0 ? n : line ? at : at + 2;
				ev.push([i, end, true]);
				i = end;
				continue;
			}
			if (c === "/" && regexAllowed() && regex()) {
				prev = "/";
				prevAt = i - 1;
				continue;
			}
			if (jsx && c === "<" && regexAllowed() && element()) {
				prev = ")";
				prevAt = i - 1;
				continue;
			}
			if (c === "`") {
				template();
				prev = "`";
				prevAt = i - 1;
				continue;
			}
			if ((c === '"' || c === "'") && !WORD.test(source[i - 1] ?? "")) {
				let j = i + 1;
				while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
				if (source[j] === c) {
					ev.push([i + 1, j, false]);
					push(i, i + 1, j, false, false);
					i = j + 1;
					prev = c;
					prevAt = j;
					continue;
				}
			}
			if (c === "{") depth++;
			else if (c === "}") {
				if (stop && depth === 0) return;
				depth--;
			}
			if (c > " ") {
				prev = c;
				prevAt = i;
			}
			i++;
		}
	}

	code(false);
	return buildTokens(source, ev, strings);
}
