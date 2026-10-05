# Review bot

Comment `/grok review` on an open PR and leave the session running. The agent reviews the diff against the PR's real base, fixes verified Critical and Important findings, posts one comment, and deletes the worktree it created. It does not merge or approve.

Agent instructions live in [SKILL.md](SKILL.md). This file is for installing the skill and running the watcher.

## Install

Install globally. Without `-g`, `skills add` writes into the current project.

```bash
npx skills add mrosberghaus/skills -s review-bot -g -y
```

The CLI prints the destination. Use that path for `watch-review.py`. Examples in this file and in [SKILL.md](SKILL.md) use `~/.agents/skills/review-bot/`. If yours differs, run from the printed path or symlink it there.

The child review needs Matt Pocock's `code-review`:

```bash
npx skills add mattpocock/skills -s code-review -g -y
```

`gh` must be authenticated. The poller talks to GitHub through it.

## Trigger

On an open PR, post an issue comment whose first non-empty line is `/grok review`, `/muse review`, `/claude review`, `/cursor review`, `/codex review`, or `/<name> review` for another CLI. Optional focus text can follow on that same line.

Only the watcher owner can fire it. That defaults to the `gh`-authenticated login.

`review-bot` with reviewer `grok` watches the same phrase as the standalone `grok-review` skill. Run one of them, not both.

## Watch

Open your CLI in the checkout you want to watch, preferably `main`. Then `/review-bot watch`. Leave the session idle while a review runs so further trigger comments still fire.

Watch mode is active only after the agent verifies that poll results reach a reviewer while the interactive session is idle. A Python poller alone does not start reviews. If Codex has no timer or monitored-output callback, the skill starts a persistent background coordinator; see [Codex watch without callbacks](references/codex-watch.md). Startup reports the run handle, logs, and stop method. If permissions prevent a working handoff, the agent reports watch mode unavailable.

The poller needs a reviewer name. Pass `--reviewer` or set `REVIEW_BOT_REVIEWER`. It will not start without one.

```bash
cd <checkout>
python3 ~/.agents/skills/review-bot/scripts/watch-review.py --reviewer grok --once
```

`--once` does one poll and exits. The first run with no state is a silent baseline, not proof that no requests are waiting. Later runs print `ACTION_REQUIRED` JSON for new trigger comments. Without `--once` the script polls forever. Inspect its log for errors: a failed poll can still exit 0 with no output. Run `--help` for the rest of the flags.

Start recipes for each CLI live in [SKILL.md](SKILL.md).

Never run two watchers on the same reviewer and repo. They share one `seen.json` and will race.

State path: `~/.agents/plugin-data/<reviewer>-review/<owner>__<repo>/seen.json`.

`seen.json` records detected comments, not completed reviews. The agent journals dispatch and completion separately. After a lost handoff or restart, it recovers emitted requests from the journal and watcher logs, even when their IDs are already seen. It checks existing request-linked summaries before repeating side effects. Historical comments suppressed by the first-run baseline are not automatically replayed; use a one-shot run for a known waiting PR.

```bash
python3 ~/.agents/skills/review-bot/scripts/watch-review.py --self-check
```

## One-shot

From a session already in the repo:

```
/review-bot 4345
```

That reviews PR 4345 as your CLI's reviewer. No trigger comment, no reactions.
