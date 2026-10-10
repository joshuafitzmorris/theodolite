# theodolite

A map of who writes what in your codebase, enforced on every pull request, plus the rules agents need to move fast inside it.

A theodolite is the instrument a surveyor uses to fix a boundary line before anything is built. This one surveys who writes what and fails the pull request when a line moves.

With coding agents, what silently breaks a codebase is a new writer: a route handler that writes a table it never touched, a component that calls Stripe directly, a script that sends email. Reviews miss it. A declared matrix with a scanner does not.

## What a pull request gets

The workflow `init` writes runs `theodolite check --base origin/main` on every pull request and posts one comment:

```
src/app/api/checkout/route.ts:6  writes db.order (prisma.order.create)  db.order is written by src/repositories/orders.ts; call it from there, or say in the PR why this file must write it.
src/app/api/checkout/route.ts:7  writes external.stripe (stripe.paymentIntents.create)  external.stripe is written by src/lib/stripe.ts; call it from there, or say in the PR why this file must write it.
theodolite: 1 changed file, 2 new write sites, 2 errors, 0 warnings, 0 grandfathered
doors: new writer src/app/api/checkout/route.ts -> db.order; new external call src/app/api/checkout/route.ts -> external.stripe
```

Only the files the pull request changed are scanned, and only write sites that are new since the base count. The check fails on findings. The last line is the door verdict: `doors: none`, or every door the change opens: a new writer or external call, a migration or schema file, a dependency added, an auth or CI path touched, a test skipped or focused, an assertion deleted. Door-free pull requests get the label `doors:none`. Merge those on green and the agent's summary; spend review on the rest.

An agent that hits a finding moves the write into the module that owns the resource. It cannot edit `theodolite.toml`: the permissions deny it, including `>` redirects into the file.

## Install

Node 22 or newer.

```sh
npx theodolite init
```

`init` writes three things and appends one block, then prints what to do next:

| What | Where |
|---|---|
| The matrix, seeded from the code when there is any | `theodolite.toml` |
| The workflow above | `.github/workflows/theodolite.yml` |
| Permissions, hooks and three pinned subagents (opus plans, sonnet implements, haiku does mechanical work), merged into what you have | `.claude/settings.json`, `.claude/agents/` |
| Seven rules for agents | appended to `AGENTS.md`, else `CLAUDE.md`; both created when neither exists |

It never overwrites `AGENTS.md` and does nothing on a second run. `--dry-run` writes nothing; `--force` overwrites the matrix, the workflow and the subagent files.

## The matrix

Seeded from a small Next.js app:

```toml
[scan]
include = ["**"]
languages = ["ts", "py"]

[resources."db.order"]
writers = [
  "src/repositories/orders.ts",  # TODO(tighten) 2 sites
]

[resources."external.stripe"]
match = ["new Stripe("]
writers = [
  "src/lib/stripe.ts",  # TODO(tighten) 1 site
]
```

Replace each `TODO(tighten)` path with a glob you trust. `writers = []` means nothing may write the resource; it is the strongest rule and the easiest to check. Constructed SDK clients (`new Stripe(`, `new Resend(`, `new OpenAI(`, Supabase's `createClient(`, `new S3Client(`) are declared on day one, so a call on one from the wrong file is a finding even when the client is imported from a shared module.

Detected:

| Resource | TypeScript and JavaScript | Python |
|---|---|---|
| `db` | SQL in strings; Prisma, Drizzle, knex, Supabase; generic ORM calls | SQL in strings; SQLAlchemy; Django |
| `external`, `effect` | `fetch`, `axios`, `got`, `ky` mutations by host; SDK clients; `match` | `requests`, `httpx` mutations by host; `match` |
| `fs` | `fs` and `Bun.write` calls, by path prefix | `open` in write mode, `Path`, `shutil`, `os` |

What it does not do: no cross-file dataflow, so a query built in one file and run in another is not followed; a dynamic table name (`INSERT INTO ${table}`) is reported as `?` and must be declared by alias; detection is token-level, so writes can be missed and a finding on a non-write is a bug; reads are never restricted. The schema and every output format are in [docs/matrix.md](docs/matrix.md).

## Grandfathering

On an existing repository `report` prints the matrix with every undeclared write added to `[grandfathered]`, one `"file" = ["resource"]` line each, and nothing else changed. It never widens `writers` and never touches a `writers = []` resource. `check` prints the count on every run, flags a pair whose write is gone, and under `--strict` fails when the table has more pairs than the committed `theodolite.toml`. The number only falls.

## The rules agents get

1. Before you say done, run `npm run check` and show the last lines. If it failed or could not run, say that first. Report in 15 lines or fewer: what changed, what you ran, what you need from the human.
2. Do the ticket and nothing else, under 400 lines. Mention anything unrelated in one line. Don't fix it, don't file it.
3. No new abstraction, option, flag, layer or service before its third caller. Copying twice is fine.
4. Write no docs nobody asked for: no new .md files, no summaries, no comments that restate the code. Fix a doc only when your change makes it wrong.
5. Test only failures you can name, and name each in a `guards:` comment. Never make a red test green by skipping, focusing, loosening or deleting it.
6. If `theodolite check` flags a write, move it into the module that owns that resource. If you can't, say why in the PR. Never edit theodolite.toml.
7. Migrations, dependencies, auth, deploys and merges ask permission. Don't route around a prompt. Put the question and the default you're taking in your report, and keep going on what doesn't depend on it.

Rule 1 names the repository's own check command when `package.json` has one. Rules 6 and 7 are enforced by code: `.claude/settings.json` denies edits to the rules, the permissions, `.env*` and `theodolite.toml`, and asks before migrations, schema files, dependencies, auth, CI, deploys, pushes and merges.

## The status file

The Stop and SubagentStop hooks run `theodolite status`. It writes a line only when the agent's last message asks you something: time, branch, the question, and the default the agent took.

```
2026-10-10 14:02  checkout-route  Should I run the migration now?  default: not run; it waits for you.
```

One `STATUS.md` at the main worktree root, shared by every worktree and git-ignored. No model runs; nothing is written when nobody needs you.

## Commands

| Command | What it does |
|---|---|
| `init` | Writes the kit. `--dry-run`, `--force`. |
| `check` | Scans against `theodolite.toml`. Exit 0 clean, 1 errors, 2 config error. `--base <ref>` scans only what changed and prints the door verdict; `--strict` fails on warnings and on a grown `[grandfathered]`; `--json` prints findings. |
| `report` | Prints a proposed matrix, or the existing one with new writes grandfathered. Writes nothing. |
| `status` | The hook script above. |

## Design notes

**Grep-level detection first.** It is fast, needs no setup and is honest about its limits. Each language is a preset of detectors returning write sites, so an AST-based preset can replace one.

**The finding names the owner.** Most findings are fixed in code by calling the owner, without a human; widening the matrix suggests the exact file, never a directory.

**Only what changed.** A pull request is judged on the sites it adds. The tree's history is noise the human already accepted.

## Contributing

Run `npm run check`. Tests use fixtures: a line that must yield a site ends with `// expect: <resource> <confidence>`; any other site fails. To add a preset, add detectors under `src/scan/presets/` with a fixture per shape.

## Licence

MIT.
