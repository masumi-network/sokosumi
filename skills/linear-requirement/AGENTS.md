# linear-requirement Skill (retired for this repo)

**This repo no longer files work in Linear.** Specs and tickets are Sokosumi Tasks.

## What to do instead

1. Load [`.agents/skills/sokosumi/`](../../.agents/skills/sokosumi/) (`SKILL.md`).
2. Follow [`docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md) to create or update a Task (`tasks create` / `tasks update` with `--description-file` for the requirement body).
3. Prefer `--preprod`. Confirm the brief and write authorization before creating.

## Runtime notes

- `disable-model-invocation: true` — do not auto-start. If the user still names this skill, redirect them to the sokosumi skill and issue-tracker doc; do not call Linear CLI or Linear MCP for new Sokosumi work.
- Canonical Linear publish recipes remain in this folder for historical installs only. Do not use them for this repository.
