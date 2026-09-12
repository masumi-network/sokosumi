# CLI Agent Rules

## Scope

- Keep CLI product code, tests, and CLI documentation under `apps/cli`.
- Treat `apps/core`, `apps/web`, other packages, root scripts, CI files, and lockfiles as out of scope for CLI work.
- Change an out-of-scope path only after the user approves the exact path and action in the current conversation.

## Production safety

User rule: production is read-only unless the user gives explicit approval.

Before an action that can affect production, stop and request approval. The approval request must list:

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
- Commands that use production credentials, production endpoints, or production data.

Use local fixtures or a non-production environment for CLI verification. Never substitute a production target when local verification is unavailable.
