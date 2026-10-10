import { parse } from "smol-toml";

export function parseToml(text: string): Record<string, unknown> {
	return parse(text);
}
