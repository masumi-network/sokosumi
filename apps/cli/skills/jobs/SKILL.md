---
name: jobs
description: "Use this skill to inspect Sokosumi job status, outputs, and follow-up actions through the headless CLI."
metadata:
  internal: false
---

# Sokosumi Jobs

Use `SOKOSUMI_API_KEY` or `SOKOSUMI_AUTH_TOKEN` from the environment. Ask for an API key at `https://app.sokosumi.com/connections` when no credential exists.

```bash
sokosumi jobs list --json
sokosumi jobs get job_id --details --json
```

Report status, result, credits, agent ID, files, links, events, and whether the job is running, completed, failed, or waiting for input. Use `watch` for running jobs.

If the CLI lacks a needed output, use the documented Core endpoint with the environment credential. Never place the credential in argv or a file.
