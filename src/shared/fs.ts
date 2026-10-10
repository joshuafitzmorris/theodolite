import { readFileSync } from "node:fs";

/** File text, or undefined when the file does not exist. Other read errors still throw. */
export function readIfExists(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw err;
	}
}
