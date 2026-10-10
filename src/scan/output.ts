// Human lines and JSON.

import type { Finding, ResolveResult } from "./resolve.ts";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function summarize(res: ResolveResult) {
	const count = (s: Finding["severity"]) => res.findings.filter((f) => f.severity === s).length;
	return {
		files: res.files,
		sites: res.writeSites,
		errors: count("error"),
		warnings: count("warning"),
		notes: count("note"),
	};
}

export function humanOutput(res: ResolveResult): string {
	const s = summarize(res);
	const gf = res.findings.filter((f) => f.rule === "grandfathered").length;
	const total = `${plural(s.files, "file")}, ${plural(s.sites, "write site")}, ${plural(s.errors, "error")}, ${plural(s.warnings, "warning")}`;
	return [
		...res.findings.map((f) => `${f.file}:${f.line}  ${f.message}`),
		`theodolite: ${total}, ${gf} grandfathered`,
	].join("\n");
}

/** Findings carry their human text in `message`; the JSON shape leaves it out. */
export const jsonOutput = (res: ResolveResult) =>
	JSON.stringify({ version: 1, summary: summarize(res), findings: res.findings }, (k, v) =>
		k === "message" ? undefined : v,
	);
