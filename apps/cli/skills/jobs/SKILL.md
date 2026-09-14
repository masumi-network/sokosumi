---
name: jobs
description: "Use when inspecting Sokosumi jobs or submitting answers to pending job input requests through the headless CLI."
metadata:
  internal: false
---

# Sokosumi Jobs

Use `SOKOSUMI_API_KEY` for a user API key or `SOKOSUMI_AUTH_TOKEN` for an OAuth access token. Both become bearer credentials. Keep them in the environment and never put them in arguments, files, logs, or input data.

```bash
sokosumi jobs list --json
sokosumi jobs get JOB_ID --details --json
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"..."}' --json
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-file INPUT_FILE --json
```

`jobs get --details` returns a pending `inputRequest` with `eventId`, `message`, and `inputSchema`. Submit one non-empty JSON object that matches the schema. Use `watch` to pause for human input, resume after submission, surface feedback, and stop at terminal status.
