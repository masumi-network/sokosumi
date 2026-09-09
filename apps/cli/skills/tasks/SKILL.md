---
name: tasks
description: "Use when creating, inspecting, or commenting on Sokosumi coworker tasks through the headless CLI."
metadata:
  internal: false
---

# Sokosumi Tasks

Use `SOKOSUMI_API_KEY` for a user API key or `SOKOSUMI_AUTH_TOKEN` for an OAuth access token. The latter is not an API key. Both become bearer credentials. Keep them in the environment and never put them in arguments, files, logs, or task descriptions.

```bash
sokosumi tasks list --json
sokosumi tasks create --coworker-id COWORKER_ID --name "Task title" --description "Task brief" --status READY --json
sokosumi tasks get TASK_ID --json
sokosumi tasks events TASK_ID --json
sokosumi tasks jobs TASK_ID --json
sokosumi tasks comment TASK_ID --comment "TEXT" --json
```

Use the `watch` skill for a running task. It is a skill, not a `sokosumi tasks watch` command. For task status `INPUT_REQUIRED` with a clarification comment and no linked job `inputRequest`, submit the human's answer with `sokosumi tasks comment TASK_ID --comment "TEXT" --json`, then resume polling. Do not pass `--status` or move the task to `READY` or `RUNNING`; the assigned coworker controls that transition. For a linked job `inputRequest`, use the `jobs` skill. Send an ordinary comment only when the user explicitly asks. Ask before changing status, retrying, or switching coworkers. Report task IDs, statuses, latest activity, linked jobs, errors, and the next user action.

If no credential exists, ask the user for an API key at `https://app.sokosumi.com/connections`. Never pass credentials in arguments.
