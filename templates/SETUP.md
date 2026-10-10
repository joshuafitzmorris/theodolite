# Setup: ${project}

Written by `theodolite init` (${year}). Delete this file when both lists are done.

## New repo
- [ ] Run `npx theodolite init` and commit the files.
- [ ] Fill in `scripts/verify` so it runs typecheck, lint and the targeted tests in under 60 seconds.
- [ ] Fill in ARCHITECTURE.md: modules, data flow, nouns, one-way doors.
- [ ] Edit `theodolite.toml`: declare each resource and the modules that may write it.
- [ ] Pick a model tier per kind of work (see `.claude/agents/`).
- [ ] Open the first issue from the task template.
- [ ] Let an agent open the first PR; read "In plain English" first.

## Existing repo
- [ ] Run `npx theodolite init` and commit the files on a branch.
- [ ] Run `npx theodolite report > theodolite.toml` to propose a matrix from what the code does today.
- [ ] Open the matrix as a PR and review every entry. Grandfather what you cannot fix yet with `TODO(tighten)`.
- [ ] Write ARCHITECTURE.md from the tree. Add the one-way paths you find (migrations, auth, deploy).
- [ ] Fill in `scripts/verify` from your real test runner and type config.
- [ ] Run CI in warn mode for a week. The workflow already ignores exit codes.
- [ ] Flip CI to fail: remove `|| true` from the check step in `.github/workflows/theodolite.yml`.
