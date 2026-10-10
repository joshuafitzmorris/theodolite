import type { Lang, Preset } from "../tokens.ts";
import { py } from "./py.ts";
import { ts } from "./ts.ts";

export const PRESETS: Record<Lang, Preset> = { ts, py };
