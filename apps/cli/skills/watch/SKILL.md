---
name: watch
description: "Use when monitoring a long-running Sokosumi task or job, surfacing feedback, or handling pending input requests."
metadata:
  internal: false
---

# Sokosumi Watch

Use one watcher for one task or job. Keep the resource ID and the IDs of events already reported.

## Poll

For a task, poll its state, events, and linked jobs:

```bash
sokosumi tasks get TASK_ID --json
sokosumi tasks events TASK_ID --json
sokosumi tasks jobs TASK_ID --json
```

For each linked job, poll details:

```bash
sokosumi jobs get JOB_ID --details --json
```

Use a background runner when available. Do not busy-loop or start a second watcher for the same resource. Compare event IDs with the last poll and report each event once.

## Pending task input

When the task status is `INPUT_REQUIRED` and its latest task event contains a clarification comment, show the task ID, event ID, and comment. Pause the watcher and ask the human for the answer. Use this branch when no linked job has an `inputRequest`.

Submit the human's answer once:

```bash
sokosumi tasks comment TASK_ID --comment "TEXT" --json
```

Do not pass `--status` to answer the request. Do not move the task to `READY` or `RUNNING`; the assigned coworker controls the next task transition. Poll the task again after submission.

## Pending job input

When job details contain `inputRequest`, show its `eventId`, `message`, and `inputSchema`. Pause the watcher and ask the human for one matching JSON object. Do not invent an answer.

Submit the human's answer once:

```bash
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"..."}' --json
```

Use `--input-file` when shell history must not contain the object. Poll the job again after submission. The API returns one oldest pending request at a time, so repeat this step when another request appears.

Use `tasks comment` only for task-level `INPUT_REQUIRED`. Use `jobs input` only for a job `inputRequest`.

## Feedback and completion

Surface new task comments, task status events, job messages, and job status changes. Ask the human before sending a reply, changing status, retrying, or switching coworkers. Use `sokosumi tasks comment TASK_ID --comment "TEXT" --json` only when the user asks for feedback to be sent.

Pause when the task status is `INPUT_REQUIRED` or a job reports a pending input request. Resume after the matching human answer is submitted. Stop only when the task or job reports success, failure, or cancellation. Fetch final details and report status, IDs, errors, output files, links, and the next user action. A pending input request never means the work is complete.

Credentials come from `SOKOSUMI_API_KEY` or `SOKOSUMI_AUTH_TOKEN` in the environment. Never put them in commands, files, logs, or feedback. `watch` is a skill, not a `sokosumi watch` command.
