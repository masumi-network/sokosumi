---
name: agents
description: "Use this skill to browse, search, inspect, and hire Sokosumi marketplace agents through the headless CLI."
metadata:
  internal: false
---

# Sokosumi Agents

Use `SOKOSUMI_API_KEY` or `SOKOSUMI_AUTH_TOKEN` from the environment. If no credential exists, ask the user for an API key from `https://app.sokosumi.com/connections`.

```bash
sokosumi agents list --json
sokosumi agents list --search "code review" --json
```

Confirm the deliverable and credit cap. Fetch the required input schema before hiring. Do not guess required fields.

```bash
sokosumi agents hire agent_id --input-json '{"prompt":"Task brief"}' --max-credits 25 --json
sokosumi jobs get job_id --details --json
```

Use `watch` when the returned job is still running. Keep the job ID in context.

API keys never go in argv. Use environment variables or `auth login --api-key-stdin`.
