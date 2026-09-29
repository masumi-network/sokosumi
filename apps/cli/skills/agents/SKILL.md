---
name: agents
description: "Use when browsing, searching, inspecting, or hiring Sokosumi marketplace agents through the headless CLI."
metadata:
  internal: false
---

# Sokosumi Agents

[VERIFIED: `apps/cli/src/auth/auth-manager.ts`, `apps/cli/src/cli/auth-whoami.ts`] Use stored CLI credentials or operator-configured environment or stdin input. Run `auth whoami --json` on the selected target before setup writes. Before switching browser accounts, clear `SOKOSUMI_API_KEY` and `SOKOSUMI_AUTH_TOKEN`; they override saved OAuth credentials. Switch the browser account, run `auth login`, then verify identity. Never request credentials in chat or put them in arguments, plaintext files, logs, or Task content.

Use existing user authorization for writes. If it does not cover the intended change, ask before that change. Inspect state before repeating an uncertain write.

## Select and hire

```bash
sokosumi agents list --json
sokosumi agents list --search "SPECIALTY" --json
```

Confirm the deliverable and credit cap. `agents hire` fetches the required input schema internally. Pass matching `--input-json` or `--input-file`. Do not guess required fields.

```bash
sokosumi agents hire AGENT_ID --input-json '{"prompt":"Task brief"}' --max-credits 25 --json
sokosumi jobs get JOB_ID --details --json
```

Keep the returned job ID. Use `watch` when that Skill is installed. Otherwise poll with the `jobs get` command above. Keep one watcher, report each event once, and follow the input steps below. Keep the selected target.

When job details contain `inputRequest`, show its `eventId`, `message`, and `inputSchema`. Pause and ask the human for one matching non-empty JSON object. Submit it once:

```bash
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"..."}' --json
```

Use `--input-file` when shell history must not contain the object. Poll again after submission. Repeat when another pending request appears.

Surface job messages and status changes. Ask before replying, retrying, or changing the job. Direct jobs have no documented feedback-reply command. Do not invent one. Report the terminal status, errors, output files, links, and next user action.
