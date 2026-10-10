// Python tokenizer: comments, prefixed and triple-quoted strings, docstrings as comments.

import { buildTokens, calleeBefore, type Ev, type Str, type Tokens } from "../tokens.ts";

export function tokenizePy(source: string): Tokens {
	const n = source.length;
	const ev: Ev[] = [];
	const strings: Str[] = [];

	/** The last significant character before `p`, looking through comments. */
	const sigBefore = (p: number) => {
		let k = p - 1;
		let e = ev.length - 1;
		for (;;) {
			while (k >= 0 && (source[k] ?? "") <= " ") k--;
			while (e >= 0 && (ev[e]?.[0] ?? 0) > k) e--;
			const x = ev[e];
			if (x?.[2] && k < x[1]) {
				k = x[0] - 1;
				e--;
			} else return k < 0 ? "" : (source[k] ?? "");
		}
	};

	let i = 0;
	while (i < n) {
		const c = source[i] ?? "";
		if (c === "#") {
			const end = source.indexOf("\n", i);
			ev.push([i, end < 0 ? n : end, true]);
			i = end < 0 ? n : end;
			continue;
		}
		if (c !== '"' && c !== "'") {
			i++;
			continue;
		}
		let p = i;
		while (p > 0 && i - p < 2 && /[rRbBfFuU]/.test(source[p - 1] ?? "")) p--;
		if (p < i && /[\w]/.test(source[p - 1] ?? "")) p = i;
		const delim = source.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
		let j = i + delim.length;
		while (j < n && !source.startsWith(delim, j)) {
			if (source[j] === "\\") j += 2;
			else if (delim.length === 1 && source[j] === "\n") break;
			else j++;
		}
		if (!source.startsWith(delim, j)) {
			i++;
			continue;
		}
		const lineStart = source.lastIndexOf("\n", p - 1) + 1;
		const sig = sigBefore(p);
		if (delim.length === 3 && source.slice(lineStart, p).trim() === "" && (sig === "" || sig === ":")) {
			ev.push([p, j + 3, true]);
		} else {
			const value = source.slice(i + delim.length, j);
			ev.push([i + delim.length, j, false]);
			strings.push({
				start: p,
				quote: i,
				bodyStart: i + delim.length,
				bodyEnd: j,
				end: j + delim.length,
				value,
				interp: /[fF]/.test(source.slice(p, i)) && value.includes("{"),
				tag: "",
				fn: calleeBefore(source, p),
			});
		}
		i = j + delim.length;
	}
	return buildTokens(source, ev, strings);
}
