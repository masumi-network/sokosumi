---
name: tasks
description: "Use when creating, inspecting, or commenting on Sokosumi coworker tasks through the headless CLI."
metadata:
  internal: false
---

# Sokosumi Tasks

[VERIFIED: `apps/cli/src/auth/auth-manager.ts`, `apps/cli/src/cli/auth-whoami.ts`] Use stored CLI credentials or operator-configured environment or stdin input. Run `auth whoami --json` on the selected target before setup writes. Before switching browser accounts, clear `SOKOSUMI_API_KEY` and `SOKOSUMI_AUTH_TOKEN`; they override saved OAuth credentials. Switch the browser account, run `auth login`, then verify identity. Never request credentials in chat or put them in arguments, plaintext files, logs, or Task content.

Use existing user authorization for writes. If it does not cover the intended change, ask before that change. Inspect state before repeating an uncertain write.

[VERIFIED: `apps/cli/src/cli/index.ts`, `apps/cli/src/api/http-client.ts`; Core `apps/core/src/middleware/organization.ts`] Keep the user's selected target. For organization Tasks, discover the slug and organization ID with `workspaces list --json`. Check `workspaces check ORGANIZATION_ID --json` before creation. Include the selected slug on every `tasks` command below. Core checks membership and Task permissions. Without the flag, OAuth defaults to the personal Workspace. Omit it only when that default context is intended. The flag does not change the network and is rejected outside `tasks`. Runtime commands use `--organization-id` separately.

```bash
sokosumi tasks list --organization-slug WORKSPACE_SLUG --json
sokosumi tasks create --organization-slug WORKSPACE_SLUG --coworker-id COWORKER_ID --name "Task title" --description "Task brief" --status READY --json
sokosumi tasks get TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi tasks events TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi tasks jobs TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi tasks comment TASK_ID --organization-slug WORKSPACE_SLUG --comment "TEXT" --json
```

Use `watch` for a running Task when that Skill is installed. Otherwise use the `get`, `events`, and `jobs` commands above with one watcher. Preserve the selected Workspace slug. Report each event once and pause for required human input. `watch` is a Skill, not a `sokosumi tasks watch` command.

For task status `INPUT_REQUIRED` with a clarification comment and no linked job `inputRequest`, submit the human's answer with the `tasks comment` command above, then resume polling. Do not pass `--status` or move the task to `READY` or `RUNNING`; the assigned coworker controls that transition. Send an ordinary comment only when the user explicitly asks. Ask before changing status, retrying, or switching coworkers. Report task IDs, statuses, latest activity, linked jobs, errors, and the next user action.

[VERIFIED: `apps/cli/src/cli/commands/jobs.ts`] For a linked job, run `sokosumi jobs get JOB_ID --details --json`. If it returns `inputRequest`, show the request to the human and pause. Submit their matching JSON answer once with `sokosumi jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"..."}' --json`, then read the job again. Use the `jobs` Skill if installed. Keep the selected target; do not pass the Task Workspace flag to job commands.
