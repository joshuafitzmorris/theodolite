# theodolite

Opinions on running coding agents, kept small, with a check behind each one that can have a check. A theodolite is the instrument a surveyor uses to fix a boundary line before anything is built.

## The opinions

1. **Declare boundaries; don't discover them in review.** Who writes what is a file. A new writer fails the build. [check]

2. **TDD is the wrong default for agents.** A test written first pins an implementation before you've seen its shape, and an agent makes it green by weakening it. Write tests after the shape settles, only for failures you can name, and treat a skipped or loosened test as a build failure. [check fails on a skipped or focused test; a deleted assertion is a door]

3. **Simple beats clever.** You are not Google; you don't have its volume or its headcount. One deployable, one repo, no abstraction before its third caller, no service until a boundary forces one. [stance; the matrix makes "a boundary forces one" visible]

4. **The feedback loop is the speed limit.** One command, under a minute, that shows the thing working. If the loop is slow, fix that before the feature. [stance, named in AGENTS.md]

5. **The human reviews doors, not diffs.** A PR that opens no one-way door (new writer, migration, dependency, auth, CI) merges on green plus a five-line summary. Review time goes to the ones that do. [doors label]

6. **Complexity never passes the human unread.** Every PR explains itself in plain English. Agents ask with a default and keep going; they never stop and wait. [the label waits for a description; needs-you lines]

7. **The cheapest model that can be checked.** Haiku for mechanical work, Sonnet to implement, Opus to plan and review. [subagent files]

8. **Nothing is enforced by hope.** A rule either has a check behind it or it is labelled a stance. [the kit's own discipline]

## What init writes

Node 22 or newer.

```sh
npx theodolite init
```

| What | Where |
|---|---|
| The matrix, seeded from the code. Skipped, and said so, when nothing in the repository writes anything yet | `theodolite.toml` |
| The workflow: `check --base` on every pull request, one comment, the `doors:none` label | `.github/workflows/theodolite.yml` |
| Permissions, hooks and the three subagents, merged into what you have | `.claude/settings.json`, `.claude/agents/` |
| Seven rules for agents, the opinions above in the imperative | appended to `AGENTS.md`, else `CLAUDE.md`; both created when neither exists |

It prints what to do next instead of writing a checklist, adds `STATUS.md` to `.gitignore`, never overwrites `AGENTS.md`, and does nothing on a second run. The permissions deny edits to the rules, the permissions, `.env*` and `theodolite.toml` (including `>` redirects into it), and ask before migrations, schema files, dependencies, auth, CI, deploys, pushes and merges. The Stop hook writes a line to one `STATUS.md`, shared by every worktree, only when an agent's last message asks you something: time, branch, question, the default it took.

## The matrix

Seeded from a small Next.js app:

```toml
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

Replace each `TODO(tighten)` path with a glob you trust. `writers = []` means nothing may write the resource. Constructed SDK clients (`new Stripe(`, `new Resend(`, `new OpenAI(`, Supabase's `createClient(`, `new S3Client(`) are declared on day one, so a call on one from the wrong file is a finding even when the client is imported from a shared module. Detected: SQL in strings, Prisma, Drizzle, knex, Supabase and generic ORM calls; `fetch`, `axios`, `got` and `ky` mutations by host; `fs` calls by path prefix; SQLAlchemy, Django, `requests`, `httpx`, `open` and `shutil` in Python. Token-level, no cross-file dataflow, reads never restricted. A finding names the owner:

```
src/app/api/checkout/route.ts:7  writes external.stripe (stripe.paymentIntents.create)  external.stripe is written by src/lib/stripe.ts; call it from there, or say in the PR why this file must write it.
```

On an existing repository `report` adds undeclared writes to `[grandfathered]` and changes nothing else; `check` prints the count, and under `--strict` fails when it grew since the committed matrix. The schema and every output format are in [docs/matrix.md](docs/matrix.md).

## The door verdict

`check --strict --base origin/main` scans only the files a pull request changed, counts only the write sites that are new since the base, fails on findings (a write nobody declared included), and ends with one line:

```
theodolite: 1 changed file, 2 new write sites, 2 errors, 0 warnings, 0 grandfathered
doors: new writer src/app/api/checkout/route.ts -> db.order; new external call src/app/api/checkout/route.ts -> external.stripe
```

`doors: none`, or every door the change opens: a new writer or external call outside the declared globs, the matrix itself, a migration or schema file, a dependency added, an auth or CI path touched, a test skipped or focused (also a failure), an assertion deleted. A pull request with no doors and a description gets the label `doors:none`.

## Commands

| Command | What it does |
|---|---|
| `init` | Writes the kit. `--dry-run`, `--force`. |
| `check` | Scans against `theodolite.toml`. Exit 0 clean, 1 errors, 2 config error. `--base <ref>` scans only what changed and prints the door verdict, with or without a matrix; `--strict` fails on warnings and on a grown `[grandfathered]`; `--json`. |
| `report` | Prints a proposed matrix, or the existing one with new writes grandfathered. Writes nothing. |
| `status` | The hook script. |

Run `npm run check` before a pull request. Tests use fixtures: a line that must yield a site ends with `// expect: <resource> <confidence>`.

## Licence

MIT.
