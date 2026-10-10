# The responsibility matrix

`theodolite.toml` declares who may write and construct each resource, and which files may open a connection. `check` fails on undeclared writes. `report` proposes a matrix. Reads are never restricted.

## Schema

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
paths = ["uploads/"]
writers = ["src/storage/**"]

[connections]
allow = ["src/db/client.ts"]

[grandfathered]
"src/jobs/reconcile.ts" = ["db.users"]

[doors]
paths = ["db/**", ".github/**"]
```

| Key | Default | Rule |
|---|---|---|
| `scan.include` | `["**"]` | globs |
| `scan.exclude` | `[]` | added to the default excludes |
| `scan.languages` | `["ts","py"]` | ts: `.ts .tsx .mts .cts .js .jsx .mjs .cjs`; py: `.py` |
| `scan.unmapped` | `"warn"` | `ignore`, `warn` or `error`; `--strict` makes warnings errors |
| `writers` | required | globs; `[]` is write-never |
| `constructors` | unset | globs, also writers; when set, construction elsewhere is a finding |
| `match` | required except on `db` and `fs` | substring, or `/regex/` with optional flag `i` |
| `paths` | required on `fs` | path prefixes; `fs` resources take no `match` |
| `tables`, `aliases` | `[]` | `db` only; `tables` are normalised names, `aliases` exact identifiers or expression text |
| `connections.allow`, `.match` | none, `[]` | no section disables the rule; `match` adds to the language defaults |
| `grandfathered."<glob>"` | | resource keys; the file counts as a writer and is reported as a `TODO(tighten)` note |
| `doors.paths` | built-in list | globs; replaces the list: `**/migrations/**`, `**/schema.prisma`, `**/drizzle/**`, `**/alembic/**`, `**/*.sql`, `**/auth/**`, `**/auth.ts`, `**/middleware.ts`, `.github/**` |

Resource keys are `<kind>.<name>`, kind one of `db|external|effect|queue|bucket|fs|custom`. Default excludes: `**/{node_modules,dist,build,.venv,__pycache__,migrations}/**`, `**/*.d.ts`, and test files (`*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`, `conftest.py`, anything under `test`, `tests` or `__tests__`). Globs are minimatch with `dot: true`, relative to the config file.

Normalisation: lowercase; strip quotes, brackets and a leading `schema.`; camelCase to snake_case; singular equals plural. `UserProfile` resolves to `db.user_profiles`.

Config errors exit 2. Parse errors cite smol-toml's position; others cite the key's line:

```
theodolite.toml:7:1  unknown key "writer" in [resources."db.users"] (did you mean "writers"?)
```

Same form for: unknown table; `[imports]` ("is not supported in this version"); unknown language; bad `unmapped`; bad resource key or kind; missing `writers` (`[]` means write-never); missing `match` (or `paths` on `fs`); `match` on `fs`; `paths` outside `fs`; `tables` or `aliases` outside `db`; a name or alias claimed twice; a value that is not an array of strings; empty strings; `!` globs; invalid glob or regex; unknown resource in `[grandfathered]`.

## Detection

| Resource | TypeScript and JavaScript | Python |
|---|---|---|
| `db` | SQL in strings; Prisma, Drizzle, knex, Supabase; generic ORM calls | SQL in strings; SQLAlchemy; Django; DB-API `execute` |
| `external`, `effect` | `fetch`, `axios`, `got`, `ky` mutations; `match`; SDK clients | `requests`, `httpx` mutations; `match` |
| `fs` | `fs` and `Bun.write` calls, by path prefix | `open` in write mode, `Path`, `shutil`, `os` |

**Target `?`.** A variable or interpolation in target position (`` `INSERT INTO ${table}` ``) gives `?` and an `unresolved-target` finding. Resolve it with `aliases` (db), `match` (external, effect) or `paths` (fs), or list the file in `writers`, `constructors` or `[grandfathered]` of a resource of the same kind.

**SDK clients.** `new Stripe(`, `new Resend(`, `new OpenAI(`, `createClient(` from `@supabase/supabase-js`, `new S3Client(`. A client bound in the file, or a variable named after the SDK, makes its method calls external writes, except reads (`get`, `list`, `retrieve` and similar). `report` proposes `match = ["new Stripe("]`, so they are declared on day one. A call on a client whose resource exists without the constructor in `match` gets `Add "new Stripe(" to the match of [resources."external.stripe"]`.

## Output

```
src/api/routes/users.ts:42  writes db.users (prisma.user.delete)  db.users is written by src/users/**; call it from there, or say in the PR why this file must write it.
src/users/service.ts:6  creates db.users (prisma.user.create)  db.users is created by src/users/repository.ts; call it from there, or say in the PR why this file must create it.
src/jobs/purge.ts:4  writes db.legacy_accounts (DELETE FROM legacy_accounts)  write-never: nothing may write db.legacy_accounts. Say in the PR why that must change.
src/jobs/export.ts:4  writes ? (INSERT INTO ${table})  unresolved (warning). Add "table" to the aliases of a db resource, or add a db resource that lists this file.
src/sync/push.py:2  writes db.audit_events (INSERT INTO audit_events)  unmapped (warning). Add [resources."db.audit_events"] writers = ["src/sync/push.py"]
src/routes/admin.ts:5  opens a connection (new PrismaClient)  not allowed. Add under [connections]: allow = [..., "src/routes/admin.ts"]
src/jobs/reconcile.ts:4  writes db.users (UPDATE users SET)  grandfathered, TODO(tighten)
theodolite: 11 files, 9 write sites, 4 errors, 2 warnings, 1 grandfathered
```

Sorted by file and line. `check --base <ref>` scans the files changed since the merge base, counts only new write sites, and adds a verdict:

```
theodolite: 2 changed files, 1 new write site, 1 error, 0 warnings, 0 grandfathered
doors: new writer src/api/c.ts -> db.users
```

`doors: none` when there are none; otherwise entries are joined by `; `. Door kinds: `new writer <file> -> <resource>`, `new external call <file> -> <resource>`, `migration or schema file <path>`, `auth path <path>`, `CI path <path>`, `door path <path>` (when `[doors]` is set), `dependency added <names>`, `dependency file changed <path>`, `skip or only added <file> (<line>)`, `assertion deleted <file> (<n>)`.

If `[grandfathered]` has more pairs than the committed `theodolite.toml` (the merge base under `--base`), `check` adds a warning, an error under `--strict`:

```
theodolite.toml:9  [grandfathered] grew from 1 to 2 pairs since HEAD. Shrink it, or say in the PR why.
```

`--json` prints one object. `doors` is present only with `--base`. `message` is not included.

```json
{"version":1,"summary":{"files":11,"sites":9,"errors":4,"warnings":2,"notes":1},
 "doors":["new writer src/api/c.ts -> db.users"],
 "findings":[{"rule":"undeclared-write","severity":"error","file":"src/api/routes/users.ts",
  "line":42,"col":7,"resource":"db.users","target":"user","via":"prisma.user.delete",
  "family":"prisma","confidence":"high","fix":{"key":"writers","add":"src/api/routes/users.ts"}}]}
```

`rule` is one of `undeclared-write`, `write-never`, `unresolved-target`, `unmapped-write`, `undeclared-constructor`, `undeclared-connection`, `grandfathered`, `stale-grandfathered`, `grandfathered-grew`. `severity` is `error`, `warning` or `note`. `resource` is `null` for `?` and unmapped sites.

Exit codes: 0 clean or warnings only; 1 errors; 2 usage or config error. With no files matched, `check` warns and exits 0, or 1 under `--strict`.

`report` prints and writes nothing. With no config it prints a full matrix. Every writing file is listed by exact path; unresolved sites go in an `# unmapped` block, one line per file (a lone site with its line, several with a count and their calls).

```toml
[resources."db.users"]
writers = [
  "src/users/repository.ts",    # TODO(tighten) 6 sites
  "src/admin/users.ts",         # TODO(tighten) 3 sites
]

# unmapped
# src/jobs/export.ts:17  INSERT INTO ${table}
```

With a config it prints the file as it is, with each undeclared write added to `[grandfathered]` (one `"file" = ["resource"]` line, merged into existing entries) and stale pairs dropped. Write-never sites are not grandfathered; they are listed in a `# not grandfathered` block, followed by `# unmapped`.

```toml
[grandfathered]
"src/jobs/reconcile.ts" = ["db.users"]
"src/api/routes/users.ts" = ["db.users"]

# not grandfathered
# src/jobs/purge.ts:4  writes db.legacy_accounts (DELETE FROM legacy_accounts)  write-never
```
