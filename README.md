# theodolite

A map of who writes what in your codebase, enforced in CI, plus the rules agents need to move fast inside it.

A theodolite is the instrument a surveyor uses to fix a boundary line before anything is built. This one surveys who writes what and fails the build when a line moves.

With coding agents, what silently breaks a codebase is a new writer: a route handler that writes a table it never touched, a component that calls Stripe directly, a script that sends email. Reviews miss it. A declared matrix with a scanner does not.

theodolite is a TOML matrix of resources and the modules allowed to write them. A scanner fails CI and names the entry to add. A few files give agents the rules, the permissions and a plain-English status line.

## Install

Node 22.18 or newer.

```sh
npx theodolite init                    # writes the kit; on an existing repo the matrix is seeded from the code
npx theodolite report > theodolite.toml  # regenerate the proposed matrix at any time
```

## Ten minutes on an existing repo

1. Propose a matrix from the code as it is (90 ms, 48 files).

   ```
   $ npx theodolite report > theodolite.toml
   [resources."db.fighter"]
   writers = [
     "prisma/seed.ts",          # TODO(tighten) 1 site
     "src/lib/elo/ingest.ts",   # TODO(tighten) 2 sites
   ]
   ```

2. Review each `TODO(tighten)` entry and replace paths with globs you trust.
3. Commit the matrix.
4. Run `check` in CI in warn mode. The workflow `init` writes ignores the exit code until you remove `|| true`.

   ```
   $ npx theodolite check
   scripts/scrapeUfcEvents.ts:824  writes ? (fs.writeFileSync)  unresolved (warning). Add "args.output" to the paths of an fs resource, or add an fs resource that lists this file.
   theodolite: 48 files, 15 write sites, 0 errors, 1 warning, 0 grandfathered
   ```

5. Tighten. With one writer line removed:

   ```
   src/lib/elo/ingest.ts:379  writes db.calc_run (client.calcRun.create)  not declared. Add under [resources."db.calc_run"]: writers = [..., "src/lib/elo/**"]
   theodolite: 48 files, 15 write sites, 1 error, 1 warning, 0 grandfathered
   exit 1
   ```

An agent that hits this line cannot edit `theodolite.toml`; the permissions deny it. It files a question and keeps working.

## The matrix

`init` writes this to `theodolite.toml` in an empty repo; in a repo with source it writes `report`'s proposal instead:

```toml
[scan]
include = ["src/**"]                      # monorepo: ["packages/**/src/**"]
exclude = ["**/tests/**", "**/migrations/**"]
languages = ["ts", "py"]                 # presets of write shapes per language

[resources."db.users"]                   # a table
writers = ["src/repositories/**"]
constructors = ["src/repositories/user-repository.ts"]   # one path creates it

[resources."external.stripe"]            # an external API
match = ["api.stripe.com", "new Stripe("]
writers = ["src/billing/**"]

[resources."effect.email"]               # a side effect
match = ["sendEmail(", "resend.emails.send("]
writers = ["src/notifications/**"]

[resources."db.legacy_orders"]
writers = []                             # write-never: the strongest rule

[connections]                            # who may hold a client or connection at all
allow = ["src/db/**"]

[grandfathered]                          # TODO(tighten): shrink these, never cite them as precedent
"src/services/reconcile.ts" = ["db.users"]
```

Detected:

| Resource | TypeScript and JavaScript | Python |
|---|---|---|
| `db` | SQL in strings; Prisma, Drizzle, knex, Supabase; generic ORM calls | SQL in strings; SQLAlchemy; Django |
| `external`, `effect` | `fetch`, `axios`, `got`, `ky` mutations by host; `match` | `requests`, `httpx` mutations by host; `match` |
| `fs` | `fs` and `Bun.write` calls, by path prefix | `open` in write mode, `Path`, `shutil`, `os` |

`UserProfile` resolves to `db.user_profiles`; `aliases` cover the rest.

What it does not do:

- No cross-file dataflow: a query built in one file and executed in another is not followed.
- No dynamic table names: `INSERT INTO ${table}` is reported as `?`, and so is a write through a helper or an alias (Kysely, Mongoose and Mongo collections reached indirectly, Sequelize models in lowercase variables, `executor.execute(job)` style indirection).
- No AST yet. Detection is token-level, so writes can be missed; lowercase SQL is only read inside `sql` tags and `.query(` / `.execute(` calls.
- No `[imports]` layer rules in this version.
- Reads are never restricted.

## What `init` writes

| File | What enforces it |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | Twelve rules; `CLAUDE.md` points at them. Edits denied. |
| `ARCHITECTURE.md` | Modules, data flow, nouns, one-way doors; `check --architecture` generates its "Who writes what" section. |
| `DECISIONS.md`, `QUESTIONS.md` | Append-only ledgers: agents decide and ask in one line each; only the human answers. |
| `theodolite.toml` | `check`. Edits denied. |
| `.claude/settings.json` | Denies edits to rules, config and `.env*`; asks before migrations, manifests, auth, deploys, pushes; registers hooks. |
| `.claude/agents/` | Pinned: opus plans, sonnet implements, haiku does mechanical work. |
| `.github/workflows/theodolite.yml` | Runs `check` on pull requests and posts the findings as one comment. Warn mode until you remove `|| true`. |
| PR and issue templates | Summary, what was run, decisions, matrix changes. |
| `scripts/verify`, `SETUP.md` | Typecheck, lint, tests; checklist. |
| `STATUS.md` | Written by hooks; git-ignored. |

`--dry-run` writes nothing. Existing files are never overwritten without `--force`; `settings.json` is merged.

## The rules agents get

1. Run `scripts/verify` before you say done, and paste what it printed. If it cannot run, say so.
2. Ask before you run a migration, add a dependency, change a public API, touch auth, deploy, or push to main. Ask by appending to QUESTIONS.md with a recommended default, then keep working on whatever does not depend on the answer. Never block mid-task on a question.
3. Decide anything a revert would undo. Append one line to DECISIONS.md: what, the alternative, how to reverse it.
4. Never turn a failing test green by skipping it, focusing it, deleting an assertion, or using `--no-verify`. Fix the code or ask.
5. Add at most three tests per change. Give each a `// guards:` line naming the failure it prevents. Run the targeted tests while you iterate; CI runs the full suite.
6. Keep ARCHITECTURE.md true in the same change that changes the shape. A new writer of a table, an external API or a side effect is a theodolite.toml entry in the same PR, never a surprise.
7. Use the cheapest model whose output you can check: `haiku` for renames, fixtures, grep reports and summaries; `sonnet` to implement; `opus` to plan and review. Say which one you used.
8. Report in 15 lines or fewer: what changed, what you ran, what you saw, what you need from the human.
9. One issue, one branch, one PR, under 400 lines. Work in a worktree. File unrelated fixes as new issues.
10. Add no abstraction before its third use. Add no service until a scaling or ownership boundary forces one. Prefer one deployable and one repo.
11. Use strict types. Validate every boundary: env, HTTP, DB rows, queues. Use no `any`. Make switches exhaustive. Generate types from schemas; never hand-copy a shape.
12. If the human corrects you twice on the same thing, propose the rule in QUESTIONS.md with the exact wording. The human adds it here; agents do not edit this file.

## The status line

The Stop and SubagentStop hooks run `npx theodolite status`. Each turn it appends one line to STATUS.md: time, actor, files edited, last command and result, and whether an agent needs you. 
```
2026-10-10 14:02  main  edited 3 files (src/parse.ts, src/lex.ts, …), ran tests (ok)  · needs you: no
```

No model runs. The line is derived from the hook input and the transcript, so it costs nothing and cannot drift from what happened.

## Commands

| Command | What it does |
|---|---|
| `init` | Writes the kit. `--dry-run`, `--force`. |
| `check` | Scans against `theodolite.toml`. Exit 0 clean, 1 errors, 2 config error. `--strict` fails on warnings, `--json` prints findings, `--architecture` prints a "Who writes what" section. |
| `report` | Prints a proposed matrix. |
| `status` | The hook script above. |

## Design notes

**Grep-level detection first.** It is fast, needs no setup and is honest about its limits. Each language is a preset of detectors returning write sites. The matcher reads only those, so an AST-based preset can replace one.

**The human is implied everywhere.** Agents cannot edit rules or permissions; they ask. Reads are never restricted; that adds friction and prevents nothing.

**Absences are the strongest rules.** `writers = []` means nothing may write that resource. It is the easiest rule to check.

**Three invariants.** Data shape lives in constraints. Effect coupling lives in an outbox. Process shape lives in the matrix.

## Contributing

Run `npm run check`. Tests use fixtures: a line that must yield a site ends with `// expect: <resource> <confidence>`; any other site fails. To add a preset, add detectors under `src/scan/presets/` with a fixture per shape.

## Licence

MIT.
