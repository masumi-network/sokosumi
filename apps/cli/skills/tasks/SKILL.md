---
name: tasks
description: "Use this skill to create or inspect Sokosumi coworker tasks through the headless CLI."
metadata:
  internal: false
---

# Sokosumi Tasks

Use `SOKOSUMI_API_KEY` or `SOKOSUMI_AUTH_TOKEN` from the environment. Ask for an API key at `https://app.sokosumi.com/connections` when no credential exists.

```bash
sokosumi tasks list --json
sokosumi tasks create --coworker-id coworker_id --name "Task title" --description "Task brief" --status READY --json
sokosumi tasks get task_id --json
sokosumi tasks events task_id --json
sokosumi tasks jobs task_id --json
```

Return task IDs, statuses, latest activity, linked jobs, and the next user action. Use `watch` when a READY task is still running. Never pass credentials in argv.
