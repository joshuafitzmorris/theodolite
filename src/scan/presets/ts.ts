// TypeScript and JavaScript: imports and write-shape detectors.

import { SDK_READ, SDKS } from "../sdk.ts";
import { findMatch, findSql, httpHit, pathHit } from "../shared.ts";
import type { FileContext, Hit, ImportRef, Preset, Tokens } from "../tokens.ts";
import { argValue, BUILTINS, callArgs, det, lineCol, matchClose, stmtEnd } from "../tokens.ts";
import { tokenizeTs } from "./ts-lex.ts";

const IMPORT_RE =
	/(?<![.\w$])(?:import\s*(?:([^;"'`()]*?)\s*from\s*)?|export\s*[^;"'`()]*?\s*from\s*|(?:require|import)\s*\(\s*)(?=["'])/g;

export function parseImportsTs(t: Tokens): ImportRef[] {
	const out: ImportRef[] = [];
	for (const m of t.code.matchAll(IMPORT_RE)) {
		const s = t.byQuote.get(m.index + m[0].length);
		if (s) out.push({ spec: s.value, line: lineCol(t, m.index).line, clause: m[1] ?? "" });
	}
	return out;
}

type Binds = {
	prisma: Set<string>;
	drizzle: Set<string>;
	knex: Set<string>;
	http: Map<string, string>;
	fsRecv: Set<string>;
	fsFn: Map<string, string>;
};

const FS_MODULE = /^(?:node:)?fs(?:\/promises)?$/;

const isBinds = (v: unknown): v is Binds => typeof v === "object" && v !== null && "drizzle" in v;

function bindings(t: Tokens, ctx: FileContext): Binds {
	const hit = ctx.cache.get("binds");
	if (isBinds(hit)) return hit;
	// `db` is only a Drizzle client in a file that imports drizzle-orm; elsewhere it is Dexie, a pool wrapper, a mock.
	const drizzleFile = ctx.imports.some((i) => i.spec.startsWith("drizzle-orm"));
	const b: Binds = {
		prisma: new Set(["prisma", "tx"]),
		drizzle: new Set(drizzleFile ? ["db", "tx"] : []),
		knex: new Set(["knex", "trx"]),
		http: new Map(["axios", "got", "ky"].map((n) => [n, ""])),
		fsRecv: new Set(["fs", "fsp", "promises"]),
		fsFn: new Map(),
	};
	const bound = (re: RegExp, into: Set<string>) => {
		for (const m of t.code.matchAll(re)) into.add(m[1] ?? "");
	};
	bound(/([\w$]+)\s*(?::[^=;]+)?=\s*(?:await\s+)?new\s+PrismaClient\b/g, b.prisma);
	// A parameter or variable annotated with a Prisma type is a client too.
	bound(/([\w$]+)\??\s*:\s*Prisma[\w.]*/g, b.prisma);
	bound(/([\w$]+)\s*=\s*(?:await\s+)?drizzle\s*\(/g, b.drizzle);
	bound(/([\w$]+)\s*=\s*(?:await\s+)?knex\s*\(/g, b.knex);
	for (const m of t.code.matchAll(
		/([\w$]+)\s*=\s*(?:axios\.create|got\.extend|ky\.(?:create|extend))\s*\(/g,
	)) {
		const open = m.index + m[0].length - 1;
		const base = /(?:baseURL|prefixUrl)\s*:\s*(?=["'`])/.exec(t.code.slice(open, matchClose(t.code, open)));
		b.http.set(m[1] ?? "", base ? (t.byQuote.get(open + base.index + base[0].length)?.value ?? "") : "");
	}
	for (const imp of ctx.imports.filter((i) => FS_MODULE.test(i.spec))) {
		const named = /\{([^}]*)\}/.exec(imp.clause)?.[1] ?? "";
		for (const name of imp.clause
			.replace(/\{[^}]*\}/, "")
			.replace(/\*\s*as/, "")
			.split(",")) {
			if (name.trim()) b.fsRecv.add(name.trim());
		}
		for (const part of named.split(",")) {
			const [orig = "", local = orig] = part.trim().split(/\s+as\s+/);
			if (orig === "promises") b.fsRecv.add(local);
			else if (orig) b.fsFn.set(local, orig);
		}
	}
	ctx.cache.set("binds", b);
	return b;
}

const opAt = (m: RegExpExecArray) => m.index + m[0].search(/\.[\w$]+\s*\($/);
const callText = (m: RegExpExecArray) => m[0].replace(/\s*\($/, "").replace(/\s+/g, "");
const interpExpr = (s: string) => /\{([^}]*)\}/.exec(s)?.[1] || s;

const PRISMA_OPS =
	"create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany";

function prismaHits(t: Tokens, ctx: FileContext): Hit[] {
	const { prisma } = bindings(t, ctx);
	const re = new RegExp(`([\\w$]+)\\.([\\w$]+)\\.(${PRISMA_OPS})\\s*\\(`, "g");
	const out: Hit[] = [];
	const add = (m: RegExpExecArray, model: string | undefined, op: string | undefined) => {
		ctx.claimed.add(opAt(m));
		out.push({
			offset: m.index,
			via: callText(m),
			target: model ?? "",
			construction: /^create/.test(op ?? ""),
		});
	};
	for (const m of [...t.code.matchAll(re)].filter((x) => prisma.has(x[1] ?? ""))) add(m, m[2], m[3]);
	// tRPC and T3 keep the client on the context: ctx.db.user.create(...), this.db.order.update(...).
	const member = new RegExp(`\\.db\\.([\\w$]+)\\.(${PRISMA_OPS})\\s*\\(`, "g");
	for (const m of t.code.matchAll(member)) add(m, m[1], m[2]);
	return out;
}

function drizzleHits(t: Tokens, ctx: FileContext): Hit[] {
	const { drizzle } = bindings(t, ctx);
	const out: Hit[] = [];
	for (const m of t.code.matchAll(/([\w$]+)\.(insert|update|delete)\s*\(\s*([\w$.]+)\s*\)/g)) {
		if (!drizzle.has(m[1] ?? "")) continue;
		ctx.claimed.add(opAt(m));
		out.push({ offset: m.index, via: callText(m), target: (m[3] ?? "").split(".").pop() ?? "" });
	}
	return out;
}

function tableHits(t: Tokens, ctx: FileContext, supabase: boolean): Hit[] {
	const { knex } = bindings(t, ctx);
	const out: Hit[] = [];
	const re = /(?:([\w$]+)\s*\.\s*(table|into|from)|(?<![\w$.])([\w$]+))\s*\(\s*(?=["'`])/g;
	for (const m of t.code.matchAll(re)) {
		const recv = m[1] ?? m[3] ?? "";
		const isKnex = m[3] !== undefined ? knex.has(recv) : m[2] !== "from" || knex.has(recv);
		if (supabase ? isKnex || m[2] !== "from" : !isKnex) continue;
		const s = t.byQuote.get(m.index + m[0].length);
		const close = matchClose(t.code, m.index + m[0].lastIndexOf("("));
		const ops = supabase ? "insert|update|upsert|delete" : "insert|update|upsert|del|delete|truncate";
		const op = new RegExp(`\\.(${ops})\\s*\\(`).exec(t.code.slice(close + 1, stmtEnd(t.code, close + 1)));
		if (!s || close < 0 || !op) continue;
		const via = `${m[3] ?? `${recv}.${m[2]}`}("${s.value}").${op[1]}`;
		out.push({ offset: m.index, via, target: s.interp ? interpExpr(s.value) : s.value, dynamic: s.interp });
	}
	return out;
}

function kyselyHits(t: Tokens, ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	for (const m of t.code.matchAll(/\.(insertInto|updateTable|deleteFrom)\s*\(/g)) {
		const v = argValue(t, callArgs(t.code, m.index + m[0].length - 1)[0]);
		if (v.text === "") continue;
		ctx.claimed.add(opAt(m));
		out.push({
			offset: m.index,
			via: `${m[1]}(${v.literal ? JSON.stringify(v.text) : v.text})`,
			target: v.literal ? v.text : interpExpr(v.text),
			dynamic: !v.literal,
		});
	}
	return out;
}

const MONGO_OPS =
	"insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|replaceOne|findOneAndUpdate|findOneAndDelete|findOneAndReplace|bulkWrite";
const COLLECTION = String.raw`\.collection\s*(?:<[^>()]*>)?\s*\(\s*["'\`]([^"'\`\n]+)["'\`]\s*\)`;

/** `db.collection("users").insertOne(...)`, directly or through a variable bound to the collection. */
function mongoHits(t: Tokens, ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	const live = (offset: number) => t.code[offset] === ".";
	const add = (m: RegExpExecArray, collection: string | undefined, via: string) => {
		ctx.claimed.add(opAt(m));
		out.push({ offset: m.index, via, target: collection ?? "" });
	};
	const direct = new RegExp(`${COLLECTION}\\s*\\.(${MONGO_OPS})\\s*\\(`, "g");
	for (const m of t.nc.matchAll(direct)) {
		if (live(m.index)) add(m, m[1], `collection(${JSON.stringify(m[1])}).${m[2]}`);
	}
	const bound = new Map<string, string>();
	const assign = new RegExp(
		String.raw`([\w$]+)\s*(?::[^=;]+)?=\s*(?:await\s+)?[\w$.]*?(?:\([^()]*\))?${COLLECTION}`,
		"g",
	);
	for (const m of t.nc.matchAll(assign)) {
		if (live(m.index + m[0].lastIndexOf(".collection"))) bound.set(m[1] ?? "", m[2] ?? "");
	}
	if (bound.size > 0) {
		const names = [...bound.keys()].map((n) => n.replace(/\$/g, String.raw`\$`)).join("|");
		for (const m of t.code.matchAll(new RegExp(`(?<![\\w$.])(${names})\\.(${MONGO_OPS})\\s*\\(`, "g"))) {
			add(m, bound.get(m[1] ?? ""), callText(m));
		}
	}
	return out;
}

// Mongoose (findByIdAndUpdate, updateOne, deleteMany) and Sequelize (update, destroy, bulkCreate) model statics.
const MODEL_OPS =
	"create|bulkCreate|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|replaceOne|findOneAndUpdate|findOneAndDelete|findOneAndRemove|findByIdAndUpdate|findByIdAndDelete|findByIdAndRemove|destroy";

function ormHits(t: Tokens, ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	const add = (m: RegExpExecArray, recv: string, target: string, strong: boolean, construction = false) => {
		if (ctx.claimed.has(opAt(m)) || BUILTINS.has(recv)) return;
		out.push({
			offset: m.index,
			via: callText(m),
			target,
			receiver: recv,
			confidence: strong ? "medium" : "low",
			construction,
		});
	};
	const repo = (r: string) => /^(.+?)(?:Repository|Repo)$/.exec(r)?.[1];
	for (const m of t.code.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\.(${MODEL_OPS})\\s*\\(`, "g"))) {
		const r = m[1] ?? "";
		add(m, r, r, /^[A-Z]/.test(r) || repo(r) !== undefined, /^(?:create|bulkCreate)$/.test(m[2] ?? ""));
	}
	for (const m of t.code.matchAll(/([A-Za-z_$][\w$]*)\.(save|remove|insert|update|delete)\s*\(/g)) {
		const r = m[1] ?? "";
		const x = repo(r);
		if (x !== undefined) add(m, r, x, true);
		else if (m[2] === "save" || m[2] === "remove") add(m, r, r, /^[A-Z]/.test(r));
		else if (m[2] === "update" && /^[A-Z]/.test(r)) add(m, r, r, true);
	}
	for (const m of t.code.matchAll(
		/getRepository\s*\(\s*([\w$]+)\s*\)\s*\.(insert|update|delete|save|remove)\s*\(/g,
	)) {
		add(m, m[1] ?? "", m[1] ?? "", true);
	}
	return out;
}

function httpHits(t: Tokens, ctx: FileContext): Hit[] {
	const { http } = bindings(t, ctx);
	const out: (Hit | null)[] = [];
	for (const m of t.code.matchAll(/(?<![\w$.])fetch\s*\(/g)) {
		const args = callArgs(t.code, m.index + m[0].length - 1);
		const key = args[1] && /\bmethod\s*:\s*(?=["'])/.exec(t.code.slice(args[1][0], args[1][1]));
		const verb =
			key && args[1] ? t.byQuote.get(args[1][0] + key.index + key[0].length)?.value.toUpperCase() : undefined;
		if (verb && /^(?:POST|PUT|PATCH|DELETE)$/.test(verb))
			out.push(httpHit(t, args[0], "", "fetch", `fetch ${verb}`, m.index));
	}
	for (const m of t.code.matchAll(/(?<![\w$.])([\w$]+)\.(post|put|patch|delete)\s*\(/g)) {
		const base = http.get(m[1] ?? "");
		if (base === undefined) continue;
		ctx.claimed.add(opAt(m));
		out.push(
			httpHit(t, callArgs(t.code, m.index + m[0].length - 1)[0], base, m[1] ?? "", callText(m), m.index),
		);
	}
	return out.filter((h): h is Hit => h !== null);
}

const FS_OPS = "writeFile|appendFile|rm|unlink|mkdir|rename|copyFile|createWriteStream";

function fsHits(t: Tokens, ctx: FileContext): Hit[] {
	const { fsRecv, fsFn } = bindings(t, ctx);
	const out: Hit[] = [];
	const add = (m: RegExpExecArray, op: string) => {
		const args = callArgs(t.code, m.index + m[0].length - 1);
		out.push(pathHit(t, /^(?:rename|copyFile)/.test(op) ? args[1] : args[0], callText(m), m.index));
	};
	const re = new RegExp(`(?<![\\w$.])([\\w$]+)(?:\\.promises)?\\.(${FS_OPS})(?:Sync)?\\s*\\(`, "g");
	for (const m of t.code.matchAll(re)) if (fsRecv.has(m[1] ?? "")) add(m, m[2] ?? "");
	const named = new RegExp(`^(?:${FS_OPS})(?:Sync)?$`);
	for (const m of fsFn.size > 0
		? t.code.matchAll(new RegExp(`(?<![\\w$.])(${[...fsFn.keys()].join("|")})\\s*\\(`, "g"))
		: []) {
		const orig = fsFn.get(m[1] ?? "") ?? "";
		if (named.test(orig)) add(m, orig);
	}
	for (const m of t.code.matchAll(/(?<![\w$.])Bun\.write\s*\(/g)) add(m, "write");
	return out;
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Method calls on SDK clients: `stripe.paymentIntents.create(`, `resend.emails.send(`, `s3.send(new PutObjectCommand(`.
 * A client is a variable bound to the SDK's constructor in this file, or one named after the SDK, which covers
 * a client imported from a shared module. The construction itself is a site too, so `report` sees the client.
 */
function sdkHits(t: Tokens, ctx: FileContext): Hit[] {
	const out: Hit[] = [];
	const bound = new Map<string, (typeof SDKS)[number]>();
	for (const sdk of SDKS) {
		if (sdk.module && !ctx.imports.some((i) => sdk.module?.test(i.spec))) continue;
		const ctor = escapeRe(sdk.ctor.slice(0, -1)).replace(/ /g, "\\s+");
		const re = new RegExp(`([\\w$]+)\\s*(?::[^=;]+)?=\\s*(?:await\\s+)?${ctor}\\s*\\(`, "g");
		for (const m of t.code.matchAll(re)) {
			bound.set(m[1] ?? "", sdk);
			const at = m.index + m[0].lastIndexOf(sdk.ctor.slice(0, -1));
			out.push({
				offset: at,
				via: sdk.ctor.slice(0, -1),
				kind: "http",
				target: sdk.ctor,
				receiver: m[1] ?? "",
			});
		}
	}
	for (const m of t.code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)((?:\s*\.\s*[\w$]+)+)\s*\(/g)) {
		const recv = m[1] ?? "";
		const sdk = bound.get(recv) ?? SDKS.find((s) => s.receivers.test(recv));
		if (!sdk) continue;
		// Follow the chain across calls: supabase.storage.from("x").upload(...) ends in upload.
		const methods = (m[2] ?? "").replace(/\s+/g, "").slice(1).split(".");
		let open = m.index + m[0].length - 1;
		let via = `${recv}.${methods.join(".")}`;
		for (;;) {
			const close = matchClose(t.code, open);
			const next = close < 0 ? null : /^\s*\.\s*([\w$]+)\s*\(/.exec(t.code.slice(close + 1, close + 80));
			if (!next) break;
			methods.push(next[1] ?? "");
			via = `${via}(…).${next[1]}`;
			open = close + 1 + next[0].length - 1;
		}
		const dot = t.code.lastIndexOf(".", open);
		if (ctx.claimed.has(dot)) continue;
		const method = methods[methods.length - 1] ?? "";
		if (sdk.name === "supabase" && methods[0] === "from") continue;
		if (SDK_READ.test(method)) continue;
		ctx.claimed.add(dot);
		if (method === "send") {
			const command = /^\s*new\s+([A-Z]\w*)Command\b/.exec(t.code.slice(open + 1, open + 80))?.[1] ?? "";
			if (/^(?:Get|List|Head|Describe|Select)/.test(command)) continue;
			if (command) via = `${via}(new ${command}Command`;
		}
		out.push({
			offset: m.index,
			via,
			kind: "http",
			target: sdk.ctor,
			receiver: recv,
			confidence: bound.has(recv) ? "high" : "medium",
		});
	}
	return out;
}

function newHits(t: Tokens, ctx: FileContext): Hit[] {
	return [...t.code.matchAll(/\bnew\s+([A-Z][\w$]*)\s*\(/g)]
		.filter((m) => ctx.aliases.has(m[1] ?? ""))
		.map((m) => ({ offset: m.index, via: `new ${m[1]}`, kind: "new" as const, target: m[1] ?? "" }));
}

export const ts: Preset = {
	language: "ts",
	extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
	anchor:
		/INSERT|UPDATE|DELETE|TRUNCATE|MERGE|ALTER|DROP|CREATE|\bsql\b|Raw|\.(?:create|update|upsert|delete|insert|save|remove|destroy|replace|find(?:One|By\w*)And|bulk|post|put|patch|del|query|execute|from|table|into|write|append|mkdir|rm|unlink|rename|copy)|fetch|Client|Pool|drizzle|knex|connect|writeFile|Bun|new\s+[A-Z]|\b(?:stripe|resend|openai|supabase|s3)\b/i,
	tokenize: tokenizeTs,
	parseImports: parseImportsTs,
	connectionDefaults: [
		["new\\s+PrismaClient\\s*\\(", "^@prisma/client$"],
		["new\\s+(?:Pool|Client)\\s*\\(", "^(?:pg|mysql2?|@neondatabase/serverless|@vercel/postgres)(?:/.*)?$"],
		["new\\s+MongoClient\\s*\\(", "^mongodb$"],
		["new\\s+Sequelize\\s*\\(", "^sequelize$"],
		["new\\s+DataSource\\s*\\(", "^typeorm$"],
		["(?<![\\w$.])drizzle\\s*\\(", "^drizzle-orm"],
		["(?<![\\w$.])knex\\s*\\(", "^knex$"],
		["(?<![\\w$.])createClient\\s*\\(", "^(?:@supabase/supabase-js|redis|@libsql/client)$"],
		["(?<![\\w$.])createPool\\s*\\(", "^(?:mysql2?|pg)(?:/.*)?$"],
		["mongoose\\.connect\\s*\\(", "^mongoose$"],
	].map(([pattern = "", module = ""]) => ({ pattern, module })),
	detectors: [
		det("sql", "high", false, findSql),
		det("prisma", "high", false, prismaHits),
		det("drizzle", "medium", false, drizzleHits),
		det("knex", "high", false, (t, c) => tableHits(t, c, false)),
		det("kysely", "high", false, kyselyHits),
		det("mongo", "high", false, mongoHits),
		det("supabase", "high", false, (t, c) => tableHits(t, c, true)),
		det("http", "high", false, httpHits),
		det("sdk", "high", false, sdkHits),
		det("orm", "medium", true, ormHits),
		det("fs", "high", false, fsHits),
		det("new", "high", false, newHits, true),
		det("match", "high", false, findMatch),
	],
};
