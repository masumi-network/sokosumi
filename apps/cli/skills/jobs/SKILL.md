---
name: jobs
description: "Use when inspecting Sokosumi jobs or submitting answers to pending job input requests through the headless CLI."
metadata:
  internal: false
---

# Sokosumi Jobs

[VERIFIED: `apps/cli/src/auth/auth-manager.ts`, `apps/cli/src/cli/auth-whoami.ts`] Use stored CLI credentials or operator-configured environment or stdin input. Run `auth whoami --json` on the selected target before setup writes. Before switching browser accounts, clear `SOKOSUMI_API_KEY` and `SOKOSUMI_AUTH_TOKEN`; they override saved OAuth credentials. Switch the browser account, run `auth login`, then verify identity. Never request credentials in chat or put them in arguments, plaintext files, logs, or Task content.

Use existing user authorization for writes. If it does not cover the intended change, ask before that change. Inspect state before repeating an uncertain write.

```bash
sokosumi jobs list --json
sokosumi jobs get JOB_ID --details --json
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"..."}' --json
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-file INPUT_FILE --json
```

`jobs get --details` returns a pending `inputRequest` with `eventId`, `message`, and `inputSchema`. Submit one non-empty JSON object that matches the schema. Use `watch` when that Skill is installed. Otherwise poll with `jobs get` above. Keep one watcher and the selected target. Show each new event once. Pause for the human's answer to an input request, submit it once with `jobs input`, then resume polling. Stop at terminal status and report the result.
