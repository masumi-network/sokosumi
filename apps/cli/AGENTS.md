# CLI Agent Rules

## Scope

- Keep CLI product code, tests, and CLI documentation under `apps/cli`.
- Treat `apps/core`, `apps/web`, other packages, root scripts, CI files, and lockfiles as out of scope for CLI work.
- Change an out-of-scope path only after the user approves the exact path and action in the current conversation.

## Production safety

User rule: production is read-only unless the user gives explicit approval.

Before an action that can **affect** production (writes, deploys, or other mutations), stop and request approval. The approval request must list:

- Exact command or file path.
- Target environment.
- Intended effect.
- Rollback or recovery action.
- Verification steps.
- Explicit exclusions.

Wait for an unambiguous `yes` before running the action. A general request to fix, clean, deploy, or publish is not approval.

Actions that require this gate include:

- Deploys, releases, publishes, pushes, merges, and production configuration changes.
- Database migrations, seeds, backfills, deletes, and other production database writes.
- Writes to production APIs, queues, storage, or external services.
- Other CLI commands that mutate production state (including mainnet Task create, update, link, unlink, relink, comment, and archive).

**Read-only exception (this repo's issue tracker):** Specs and tickets live on mainnet. Read-only Task tracker commands against production Core — `tasks get`, `tasks list`, `tasks links`, `tasks events`, `tasks jobs`, and `workspaces list` used only to resolve the tracker Workspace — do **not** need a fresh operator `yes`. They still use production credentials and endpoints; keep secrets out of chat, never fall back to Preprod or Linear for a known Task id, and do not treat this exception as permission to write. See [`skills/sokosumi/SKILL.md`](./skills/sokosumi/SKILL.md) and [`docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md).

Use local fixtures or a non-production environment for CLI verification of product changes. Never substitute a production write target when local verification is unavailable.

## Portable skill

The consumer skill for headless CLI work lives at [`skills/sokosumi/`](./skills/sokosumi/) (`npx skills add https://github.com/masumi-network/sokosumi --full-depth --skill sokosumi`). Keep it there as the single source. Repo-root `.agents/skills/sokosumi` and `.claude/skills/sokosumi` are symlinks to it; never install a copy at the repo root.
