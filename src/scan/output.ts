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

/** With `doors` (from `check --base`), the counts are of changed files and new sites, and the verdict line ends it. */
export function humanOutput(res: ResolveResult, doors?: string[]): string {
	const s = summarize(res);
	const gf = res.findings.filter((f) => f.rule === "grandfathered").length;
	const files = plural(s.files, doors ? "changed file" : "file");
	const sites = plural(s.sites, doors ? "new write site" : "write site");
	const total = `${files}, ${sites}, ${plural(s.errors, "error")}, ${plural(s.warnings, "warning")}`;
	const lines = [
		...res.findings.map((f) => `${f.file}:${f.line}  ${f.message}`),
		`theodolite: ${total}, ${gf} grandfathered`,
	];
	if (doors) lines.push(`doors: ${doors.length === 0 ? "none" : doors.join("; ")}`);
	return lines.join("\n");
}

/** Findings carry their human text in `message`; the JSON shape leaves it out. */
export const jsonOutput = (res: ResolveResult, doors?: string[]) =>
	JSON.stringify(
		{ version: 1, summary: summarize(res), ...(doors ? { doors } : {}), findings: res.findings },
		(k, v) => (k === "message" ? undefined : v),
	);
