## Rules for agents

1. Before you say done, run `${check}` and show the last lines. That is the one check command, and it runs in under a minute; if it is slow, fix that before the feature. If it failed or could not run, say that first. Report in 15 lines or fewer: what changed, what you ran, what you need from the human.
2. Do the ticket and nothing else, under 400 lines. Mention anything unrelated in one line. Don't fix it, don't file it.
3. No new abstraction, option, flag, layer or service before its third caller. Copying twice is fine.
4. Write no docs nobody asked for: no new .md files, no summaries, no comments that restate the code. Fix a doc only when your change makes it wrong.
5. Write tests after the shape settles, not before, and only for failures you can name; name each in a `guards:` comment. Never make a red test green by skipping, focusing, loosening or deleting it.
6. If `theodolite check` flags a write, move it into the module that owns that resource. If you can't, say why in the PR. Never edit theodolite.toml.
7. Migrations, dependencies, auth, deploys and merges ask permission. Don't route around a prompt. Put the question and the default you're taking in your report, and keep going on what doesn't depend on it.
