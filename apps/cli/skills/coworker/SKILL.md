---
name: coworker
description: "Use when selecting, assigning work to, or following up with any Sokosumi coworker by name, ID, or capability."
metadata:
  internal: false
---

# Sokosumi Coworker

Use this workflow for every coworker. Select a stable coworker ID from returned API data. A display name is a search value, not identity.

## Authentication

[VERIFIED: `apps/cli/src/auth/auth-manager.ts`, `apps/cli/src/cli/auth-whoami.ts`] Use stored CLI credentials or operator-configured environment or stdin input. Run `auth whoami --json` on the selected target before setup writes. Before switching browser accounts, clear `SOKOSUMI_API_KEY` and `SOKOSUMI_AUTH_TOKEN`; they override saved OAuth credentials. Switch the browser account, run `auth login`, then verify identity. Never request credentials in chat or put them in arguments, plaintext files, logs, or Task content.

Use existing user authorization for writes. If it does not cover the intended change, ask before that change. Inspect state before repeating an uncertain write.

## Select a coworker

Use a supplied coworker ID directly. Otherwise, discover candidates in the credential's default Workspace:

```bash
sokosumi coworkers list --scope available --search "QUERY" --json
sokosumi coworkers list --scope available --capability tasks --json
```

`--scope available` includes globally whitelisted coworkers and coworkers granted access in that Workspace. The CLI accepts only `chat` and `tasks` for `--capability`. Use `--search` for a specialty or name outside that allowlist.

[VERIFIED: `apps/cli/src/cli/index.ts`; Core `apps/core/src/middleware/auth.ts:617`, `apps/core/src/routes/v1/coworkers/get.ts:89`] OAuth defaults to the personal Workspace. The current CLI accepts `--organization-slug` only for Tasks, so this `available` lookup cannot select another organization. An empty result does not prove that the selected organization lacks a Coworker grant.

[VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`, `apps/cli/src/cli/registration-authority.ts`] For private setup on Preprod, discover existing records with `sokosumi --preprod coworkers list --scope owned --json`, `sokosumi --preprod vendors me --json`, and `sokosumi --preprod workspaces list --json`. Reuse the intended Coworker and administered Vendor. Connection requires Vendor-admin membership and membership in the selected organization, including for platform admins. Run the authorized `sokosumi --preprod coworkers connect COWORKER_ID --vendor-id VENDOR_ID --workspace-id ORGANIZATION_ID --json` and inspect its access status. `PENDING` is a successful approval request. Preserve the Coworker and access IDs, then wait for a Workspace owner or admin. Require `GRANTED` before using that Workspace. If the record is missing, a Preprod Vendor admin can provision privately under their Vendor. A platform admin can provision under another Vendor. Workspace owner or admin alone does not grant Vendor authority. Reuse the returned Coworker ID for later connection.

Read each returned `id`, `name`, and `capabilities`:

- One suitable result: use its `id`.
- Several suitable results: show the candidates and ask the user to choose.
- No suitable result: report the discovery scope. For private setup on Preprod, a Vendor admin can provision the Coworker privately. Never invent an ID.

Never choose the first result, infer an ID, or switch workers silently. The CLI uses `coworkers list`, not `agents search`, for coworker discovery.

## Create a task

Clarify the goal, deliverable, constraints, deadline, and credit cap before sending work. Confirm authorization before sending sensitive Task content to an external Coworker when existing authorization does not cover it.

[VERIFIED: `apps/cli/src/cli/index.ts`, `apps/cli/src/api/http-client.ts`; Core `apps/core/src/middleware/organization.ts`] For an organization Task, get its slug and organization ID from `workspaces list --json`. Check `workspaces check ORGANIZATION_ID --json` before creation. Use the selected slug on every `tasks` command below. The flag keeps the selected network and lets Core check membership. Without it, OAuth defaults to the personal Workspace. Omit it only when that default context is intended. Runtime commands use `--organization-id` separately.

```bash
sokosumi tasks create --organization-slug WORKSPACE_SLUG --coworker-id COWORKER_ID --name "Task title" --description "Task brief" --status READY --json
```

Keep credentials and other secrets out of the brief. Keep the returned task ID.

## Monitor work

Use `watch` for polling when that Skill is installed. Otherwise follow the polling and input steps below. Keep one watcher per resource.

[VERIFIED: `apps/cli/src/cli/index.ts`] Preserve `--organization-slug WORKSPACE_SLUG` on every organization `tasks` call, including calls made while following `watch`. Other command families reject this flag.

For each poll, check the task and its jobs:

```bash
sokosumi tasks get TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi tasks events TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi tasks jobs TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi jobs get JOB_ID --details --json
```

Use one watcher per task or job. Track seen event IDs so feedback is reported once. Keep polling until the task or job is terminal, or until an input request needs the human.

## Handle task input

When the task status is `INPUT_REQUIRED` and its latest task event contains a clarification comment, show the task ID, event ID, and comment. Use this branch when no linked job has an `inputRequest`. Pause automated work and ask the human for the answer.

After the human provides the answer, submit it once:

```bash
sokosumi tasks comment TASK_ID --organization-slug WORKSPACE_SLUG --comment "TEXT" --json
```

Do not pass `--status` to answer the request. Do not move the task to `READY` or `RUNNING`; the assigned coworker controls the next task transition. Poll the task again after submission.

## Handle job input

When `jobs get --details --json` returns `inputRequest`, show its `eventId`, `message`, and `inputSchema` to the human. Pause automated work. Do not invent an answer.

After the human provides an object that matches the schema, submit it once:

```bash
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"..."}' --json
```

Use `--input-file` for a JSON object that should not appear in shell history. After submission, poll the job again. Core returns one oldest pending request at a time, so repeat this step when another request appears.

Use `tasks comment` only for task-level `INPUT_REQUIRED` or explicitly requested task feedback. Use `jobs input` only for a job `inputRequest`.

## Handle feedback and completion

Surface new task comments, task status events, job messages, and job status changes. Ask the human before replying to feedback, changing the brief, retrying, or switching coworkers.

Stop at success, failure, cancellation, or a new task or job input request. Report IDs, status, errors, output files, links, and the next user action. Do not claim completion from an intermediate event.

Do not create a skill for one coworker. New coworkers become available through returned API data.
