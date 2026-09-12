---
name: agents
description: "Use when browsing, searching, inspecting, or hiring Sokosumi marketplace agents through the headless CLI."
metadata:
  internal: false
---

# Sokosumi Agents

Use `SOKOSUMI_API_KEY` for a user API key or `SOKOSUMI_AUTH_TOKEN` for an OAuth access token. The latter is not an API key. Both become bearer credentials. Keep them in the environment and never put them in arguments, files, logs, or task input.

## Select and hire

```bash
sokosumi agents list --json
sokosumi agents list --search "SPECIALTY" --json
```

Confirm the deliverable and credit cap. Fetch the required input schema before hiring. Do not guess required fields.

```bash
sokosumi agents hire AGENT_ID --input-json '{"prompt":"Task brief"}' --max-credits 25 --json
sokosumi jobs get JOB_ID --details --json
```

Keep the returned job ID. Use `watch` for polling and pause/resume behavior.

When job details contain `inputRequest`, show its `eventId`, `message`, and `inputSchema`. Pause and ask the human for one matching non-empty JSON object. Submit it once:

```bash
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"..."}' --json
```

Use `--input-file` when shell history must not contain the object. Poll again after submission. Repeat when another pending request appears.

Surface job messages and status changes. Ask before replying, retrying, or changing the job. Direct jobs have no documented feedback-reply command. Do not invent one. Report the terminal status, errors, output files, links, and next user action.

If no credential exists, ask the user for an API key from `https://app.sokosumi.com/connections`. API keys never go in arguments. Use the environment or `auth login --api-key-stdin`.
