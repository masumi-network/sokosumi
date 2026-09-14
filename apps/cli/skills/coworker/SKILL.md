---
name: coworker
description: "Use when selecting, assigning work to, or following up with any Sokosumi coworker by name, ID, or capability."
metadata:
  internal: false
---

# Sokosumi Coworker

Use this workflow for every coworker. Select a stable coworker ID from returned API data. A display name is a search value, not identity.

## Authentication

- `SOKOSUMI_API_KEY` is a user API key. The CLI classifies it as `api-key`.
- `SOKOSUMI_AUTH_TOKEN` is an OAuth access token. It is not an API key. The CLI classifies it as `oauth`.
- Both credentials become `Authorization: Bearer <value>` headers. If both are set, `SOKOSUMI_API_KEY` wins.
- Keep credentials in the environment. Never put them in arguments, files, logs, or task descriptions.
- If neither credential exists, ask the user for an API key from `https://app.sokosumi.com/connections`.

## Select a coworker

Use a supplied coworker ID directly. Otherwise, discover candidates in the active workspace:

```bash
sokosumi coworkers list --scope available --search "QUERY" --json
sokosumi coworkers list --scope available --capability tasks --json
```

`--scope available` includes globally whitelisted coworkers and coworkers granted access in the active workspace. The CLI accepts only `chat` and `tasks` for `--capability`. Use `--search` for a specialty or name outside that allowlist.

Read each returned `id`, `name`, and `capabilities`:

- One suitable result: use its `id`.
- Several suitable results: show the candidates and ask the user to choose.
- No suitable result: report the result and stop.

Never choose the first result, infer an ID, or switch workers silently. The CLI uses `coworkers list`, not `agents search`, for coworker discovery.

## Create a task

Clarify the goal, deliverable, constraints, deadline, and credit cap before sending work. Ask before sending sensitive task content to an external coworker.

```bash
sokosumi tasks create --coworker-id COWORKER_ID --name "Task title" --description "Task brief" --status READY --json
```

Keep credentials and other secrets out of the brief. Keep the returned task ID.

## Monitor work

**REQUIRED SUB-SKILL:** Use `watch` for polling and pause/resume behavior.

For each poll, check the task and its jobs:

```bash
sokosumi tasks get TASK_ID --json
sokosumi tasks events TASK_ID --json
sokosumi tasks jobs TASK_ID --json
sokosumi jobs get JOB_ID --details --json
```

Use one watcher per task or job. Track seen event IDs so feedback is reported once. Keep polling until the task or job is terminal, or until an input request needs the human.

## Handle task input

When the task status is `INPUT_REQUIRED` and its latest task event contains a clarification comment, show the task ID, event ID, and comment. Use this branch when no linked job has an `inputRequest`. Pause automated work and ask the human for the answer.

After the human provides the answer, submit it once:

```bash
sokosumi tasks comment TASK_ID --comment "TEXT" --json
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
