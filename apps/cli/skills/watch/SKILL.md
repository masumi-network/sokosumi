---
name: watch
description: "Use this skill to monitor a long-running Sokosumi task or job and report completion, failure, or input requests."
metadata:
  internal: false
---

# Sokosumi Watch

Use this skill after creating a READY task or direct agent job that is still running. Resolve the task or job ID from the user request or recent command output.

```bash
sokosumi tasks get task_id --json
sokosumi jobs get job_id --details --json
```

If the resource is terminal or waiting for input, report the result and stop. Otherwise poll with a background runner when available. Use the environment credential. Never paste it into commands, files, or logs.

On completion, fetch final details and report status, output, files, links, events, and any requested user action. Do not run two monitors for one ID.
