# The responsibility matrix

`theodolite.toml` declares who may write and construct each resource, hold a connection, and import each layer. `check` fails on undeclared writes; `report` proposes a matrix. Reads are never restricted.

## 1. Schema

```toml
[scan]
include = ["src/**"]
languages = ["ts", "py"]

[resources."db.users"]
writers = ["src/users/**"]
constructors = ["src/users/repository.ts"]
aliases = ["User", "usersTable"]

[resources."db.legacy_accounts"]
writers = []                      # write-never

[resources."external.stripe"]
match = ["api.stripe.com", "new Stripe("]
writers = ["src/billing/**"]

[resources."effect.email"]
match = ["sendEmail(", '/resend\.emails\.send\(/']
writers = ["src/notifications/**"]

[resources."fs.uploads"]
paths = ["uploads/"]               # path prefixes
writers = ["src/storage/**"]

[connections]
allow = ["src/db/client.ts"]

[imports]
"src/db/**" = ["src/users/**"]

[grandfathered]
"src/jobs/reconcile.ts" = ["db.users"]
```

|Key|Default|Rule|
|---|---|---|
|`scan.include`|`["**"]`|globs|
|`scan.exclude`|`[]`|added to default excludes|
|`scan.languages`|`["ts","py"]`|ts: `.ts .tsx .mts .cts .js .jsx .mjs .cjs`; py: `.py`|
|`scan.unmapped`|`"warn"`|`ignore`, `warn`, `error`; `--strict` makes warnings errors|
|`writers`|required|globs; `[]` is write-never|
|`constructors`|unset|globs, also writers; when set, construction elsewhere is a finding|
|`match`|required unless `db` or `fs`|substring or `/regex/` (flag `i`)|
|`paths`|required for `fs`|path prefixes; `fs` resources take no `match`|
|`tables`, `aliases`|`[]`|`db` only; `tables` are normalized names, `aliases` exact identifiers or expression text|
|`connections.allow`, `.match`|none, `[]`|absent section disables the rule; `match` adds to language defaults|
|`imports."<glob>"`||importer globs; files matching the key may import each other|
|`grandfathered."<glob>"`||resource keys; treated as writer, reported as a `TODO(tighten)` note|

Resource keys are `<kind>.<name>`, kind one of `db|external|effect|queue|bucket|fs|custom`. Default excludes: `**/{node_modules,dist,build,.venv,__pycache__,migrations,test,tests,__tests__}/**`, `**/*.{test,spec}.*`, `**/{test_*,*_test,conftest}.py`, `**/*.d.ts`. Globs are minimatch, `dot: true`, relative to the config file (found by walking up, or `--config`).

Normalization: lowercase; strip quotes, brackets, leading `schema.`; camelCase to snake_case; singular equals plural. `UserProfile` resolves to `db.user_profiles`.

Config errors exit 2, citing smol-toml's position for parse errors, else the key's line under its table header:

```
theodolite.toml:7:1  unknown key "writer" in [resources."db.users"] (did you mean "writers"?)
```

Same form for: missing `writers` (`[]` means write-never); bad resource key or kind; missing `match` (or `paths` for `fs`); `tables`/`aliases` outside `db`; a name or alias claimed twice; invalid glob or regex; `!` globs; empty strings; unknown resource in `[grandfathered]`; bad enum.

## 2. Write-site detection

A string is SQL in a SQL position (tags `sql`, `Prisma.sql`, `$executeRaw`, `$queryRaw`; first argument of `.query(`/`.execute(`/`.executemany(`/`.raw(`/`text(`) or when it starts with uppercase `INSERT`/`UPDATE`/`DELETE`/`WITH`/`MERGE`/`TRUNCATE`/`ALTER`/`DROP`/`CREATE`. Write shapes, case-insensitive: `INSERT INTO t`, `UPDATE t SET`, `DELETE FROM t`, `TRUNCATE [TABLE] t`, `MERGE INTO t`, `(ALTER|DROP|CREATE) TABLE [IF [NOT] EXISTS] t`.

### TypeScript / JavaScript

|Family|Matches|Target|Confidence|
|---|---|---|---|
|SQL|write shapes in SQL strings and templates|word after keyword|high|
|Prisma|`<c>.<model>.(create\|createMany\|update\|updateMany\|upsert\|delete\|deleteMany)(`; `<c>` is `prisma`, `tx`, or bound to `new PrismaClient(`|`<model>`|high|
|Drizzle|`<c>.(insert\|update\|delete)(<t>)`; `<c>` is `db`, `tx`, or bound to `drizzle(`|`<t>`, last segment|medium|
|knex|`<c>("x")` or `<c>.(table\|into\|from)("x")`, then `.(insert\|update\|upsert\|del\|delete\|truncate)(` in the statement|literal|high|
|Supabase|`.from("x")`, then `.(insert\|update\|upsert\|delete)(` in the statement|literal|high|
|TypeORM/Mongoose/Sequelize|`<R>.(create\|bulkCreate\|insertOne\|insertMany\|updateOne\|updateMany\|deleteOne\|deleteMany\|findOneAndUpdate\|destroy)(`; `<r>.(save\|remove)(`; `<x>Repository.(insert\|update\|delete)(`|receiver, `getRepository(M)`, or `<x>`|medium if PascalCase or repository, else low|
|HTTP|`fetch(u, {method: "POST\|PUT\|PATCH\|DELETE"})`; `(axios\|got\|ky).(post\|put\|patch\|delete)(u`; same on names bound to `axios.create(`/`got.extend(`/`ky.create(`|`u` text, then receiver, against `match`|high for literal, else medium|
|Filesystem|`(writeFile\|appendFile\|rm\|unlink\|mkdir\|rename\|copyFile\|createWriteStream)[Sync](` on `fs`/`fsp`/`promises` or named imports from `fs`/`node:fs`/`fs/promises`; `Bun.write(`|destination path, against `fs` prefixes|high for literal, else `?`|
|match|any non-`fs` `match` entry not preceded by `function `|owning resource|high|

### Python

|Family|Matches|Target|Confidence|
|---|---|---|---|
|SQL|as TS; any prefix, triple quotes|word after keyword|high|
|SQLAlchemy|`<s>.add(M(`, `<s>.(add_all\|delete\|merge)(x)` where `<s>` ends in `session`; `(insert\|update\|delete)(M)`; `<table>.insert()`|`M`, else argument|medium for `M`, else low|
|Django|`M.objects.(create\|get_or_create\|update_or_create\|bulk_create\|bulk_update)(`; `M.objects…` then `.(update\|delete)(` in the statement; `<x>.(save\|delete)(`|`M`, else receiver|medium for `M`, else low|
|DB-API|`<cur>.(execute\|executemany)(` with a write SQL literal or a non-literal|from SQL, or `?`|high|
|HTTP|`(requests\|httpx).(post\|put\|patch\|delete)(`, `.request("POST"`; same on names bound to `requests.Session()`/`httpx.Client(`/`httpx.AsyncClient(`|as TS|as TS|
|Filesystem|`open(p, m)`, literal `m` containing `w\|a\|x\|+`; `Path(…).(write_text\|write_bytes\|unlink\|mkdir\|rename\|touch)(`; `shutil.(copy\|copyfile\|copytree\|move\|rmtree)(`; `os.(remove\|unlink\|rmdir\|makedirs\|rename\|replace)(`|destination path|high for literal, else `?`|
|match|as TS, not preceded by `def `|owning resource|high|

**Target `?`.** A variable, interpolation or concatenation in target position (`` `INSERT INTO ${table}` ``, `f"DELETE FROM {t}"`, `"INSERT INTO " + t`) gives `?` plus the expression text. Fix: add that text to `aliases` (db) or `match`, or list the file in a resource's `writers`, `constructors` or `[grandfathered]`, by exact path or glob; the site then counts for that resource. The resource must be of the site's kind (an `fs` write needs an `fs` resource, a SQL or ORM write with a dynamic table a `db` one, an HTTP mutation with a variable URL an `external` one); when several qualify, the first in config order takes it. A `match` entry ending in `(` also resolves `?` sites of that call in the resource's writers. Otherwise: `unresolved-target`, a warning, or an error under `--strict` or `unmapped = "error"`.

## 3. Matching algorithm

1. Validate config. Walk `include` minus excludes, honouring nested `.gitignore`; skip symlinks, files over 1 MB, binaries.
2. Tokenize in one pass into `code` (comments and string bodies blanked, offsets kept) and `strings[]` (span, value, interpolations, tag or calling function). TS: `//`, `/* */`, quotes, nested `${}`, regex literals (after an operator, `(`, `,` or `return`); JSX text is not a string. Python: `#`, string prefixes, triple quotes; docstrings are comments.
3. Record client bindings and imports.
4. Run detectors over `code`, reading literals from `strings[]`; SQL runs over `strings[]`; `match` over source with comments blanked.
5. Resolve: `db` by normalized name or `tables`, then exact `aliases`; other kinds by `match` against target text, then receiver; `fs` by prefix. Low confidence resolves through `aliases` only. Builtins (`Object`, `Map`, `Set`, `Promise`, `dict`) are never targets. Duplicates on one line collapse.
6. File in `writers` or `constructors`: fine. In `[grandfathered]` for it: note. `writers = []`: `write-never`. Else `undeclared-write`.
7. Construction sites (`create`, `createMany`, `bulk_create`, `objects.create`, `session.add(M(`, `new M(` with `M` in `aliases`) outside a set `constructors`: `undeclared-constructor`, even inside `writers`.
8. Extracted target, no resource: low-confidence and receiver-based ORM sites are dropped; others are `unmapped-write` at `scan.unmapped` severity.
9. Connections: a hit outside `allow` is `undeclared-connection`. Defaults require importing their package. TS: `new (PrismaClient|Pool|Client|MongoClient|Sequelize|DataSource)(`, `(drizzle|knex|createClient|createPool|mongoose.connect)(`. Python: `(create_engine|sessionmaker|psycopg.connect|psycopg2.connect|asyncpg.create_pool|sqlite3.connect|MongoClient)(`.
10. Imports: resolve relative specifiers and Python modules from `.` and `src`; skip packages. Importing a key's path from a file matching neither the key nor its globs: `import-violation`.
11. Grandfathered pairs with no site: `stale-grandfathered` warning.

## 4. Output

```
src/api/routes/users.ts:42  writes db.users (prisma.user.create)  not declared. Add under [resources."db.users"]: writers = [..., "src/api/routes/**"]
src/jobs/purge.ts:9  writes db.legacy_accounts (DELETE FROM legacy_accounts)  write-never.
src/jobs/export.ts:17  writes ? (INSERT INTO ${table})  unresolved. Add "table" to [resources."db.users"].aliases, or add a db resource listing this file.
src/sync/push.py:12  writes db.audit_events (INSERT INTO audit_events)  unmapped (warning). Add [resources."db.audit_events"] writers = ["src/sync/**"]
src/routes/admin.ts:3  opens a connection (new PrismaClient)  not allowed. Add under [connections]: allow = [..., "src/routes/**"]
src/jobs/reconcile.ts:88  writes db.users (UPDATE users SET)  grandfathered, TODO(tighten)
theodolite: 812 files, 143 write sites, 4 errors, 1 warning, 1 grandfathered
```

Sorted by file and line; suggested globs are the file's directory plus `/**`.

`--json`:

```json
{"version":1,"summary":{"files":812,"sites":143,"errors":4,"warnings":1,"notes":1},
 "findings":[{"rule":"undeclared-write","severity":"error","file":"src/api/routes/users.ts",
  "line":42,"col":7,"resource":"db.users","target":"user","via":"prisma.user.create",
  "family":"prisma","confidence":"high","fix":{"key":"writers","add":"src/api/routes/**"}}]}
```

`rule` is one of `undeclared-write`, `write-never`, `unresolved-target`, `unmapped-write`, `undeclared-constructor`, `undeclared-connection`, `import-violation`, `grandfathered`, `stale-grandfathered`; `severity` is `error`, `warning` or `note`; `resource` is `null` for `?` and unmapped.

Exit codes: 0 clean or warnings only; 1 errors; 2 usage or config error.

`report` prints a full proposed `theodolite.toml`, reusing an existing config's `[scan]`, names and aliases, else naming resources `db.<table>`, `external.<host>`, `fs.<first segment>`. Every writing file is listed by exact path; low-confidence sites are omitted.

```toml
[resources."db.users"]
writers = [
  "src/users/repository.ts",    # TODO(tighten) 6 sites
  "src/admin/users.ts",         # TODO(tighten) 3 sites
]

# unmapped
# src/jobs/export.ts:17  INSERT INTO ${table}
```

## 5. False positives and fixtures

A missed write is acceptable in v1; a finding on a common non-write is a bug.

Fixtures: `test/fixtures/{ts,py}/NN-slug.*` sharing one `theodolite.toml`. A line that must yield a site ends with `// expect: <resource|?|unmapped> <confidence>` (`#` in Python); any other site, or an unmet expectation, fails. 
Per language: at least 25 positives (one per method or keyword in the tables) plus these traps, which yield nothing unless stated:

1. `SELECT … WHERE updated_at > $1`; `SELECT … FOR UPDATE`.
2. `INSERT … ON CONFLICT DO UPDATE SET`: one site.
3. `prisma.user.findMany`, `db.select().from(users)`, `.from("users").select`, `User.objects.filter`, `session.query(User)`.
4. SQL in line comments, block comments, docstrings.
5. `logger.info("INSERT failed")`, `console.log("Update user settings")`, `new Error("delete from cart failed")`.
6. `users.test.ts`, `tests/test_users.py`: not scanned.
7. Migration with `CREATE TABLE`: not scanned.
8. `` sql`UPDATE users SET name = ${n}` ``: `db.users`. `` `INSERT INTO ${table}` ``, `f"DELETE FROM {t}"`: `?`.
9. With `db.sessions`, `request.session.save()` and express-session `session.save()`; with `db.events` constructors, `new Event("change")`.
10. `map.delete(k)`, `params.delete("q")`, `Object.create(p)`, `settings.update({})`.
11. `"http://x"`; a regex literal containing quotes; `#` inside a Python string.
12. `fetch(url)`, `axios.get`, `requests.get`, `fs.readFile`, `open(p, "rb")`.
13. `function sendEmail(`, `def send_email(` with matching `match` entries.
14. JSX text with an apostrophe (`<p>Don't save</p>`) opens no string; a later write is still found.

## 6. Performance and plugin point

One pass per file (read, tokenize, detect, discard), keeping only sites. An anchor-word prefilter built from each preset skips files that cannot match. Target: 50,000 files under 10 s on a laptop. No AST, no network.

`src/scan/presets/ts.ts` and `py.ts` each export the pattern table:

```ts
export interface Preset {
  language: "ts" | "py";
  extensions: string[];
  tokenize(source: string): Tokens;
  parseImports(t: Tokens): ImportRef[];
  connectionDefaults: { pattern: string; module: string }[];
  detectors: { family: string; confidence: Confidence; construction: boolean;
    dropIfUnresolved: boolean; find(t: Tokens, ctx: FileContext): Site[] }[];
}
```

The matcher reads only `Site[]`, so an AST-based preset can replace a module without changing it.

## 7. Not in this version

- `[imports]`: import-direction rules are not part of v1.
- Cross-file dataflow: needs a module graph and types; too slow. Aliases and exact paths cover it.
- Dynamic table names: unknowable statically; `?` forces a declaration.
- AST: detection is token-based; an AST preset is a future plug-in (section 6).
- ORM relations: a nested `create` inside `prisma.user.create` counts for `user` only; fixing it needs the schema.
- Runtime instrumentation: needs the app running and sees only exercised paths.
