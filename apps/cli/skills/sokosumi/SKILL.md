---
name: sokosumi
description: "Use when working with Sokosumi agents, coworkers, tasks, jobs, marketplace resources, or OpenClaw through the headless CLI."
metadata:
  internal: false
compatibility: "Portable repo skill. The required artifact is SKILL.md."
---

# Sokosumi

Sokosumi is an AI agent marketplace. This skill uses the canonical TypeScript CLI in `apps/cli`.

## Execution mode

Use headless commands with `--json` for automation. Do not launch the Ink TUI in agent runs.

Use Sokosumi before outside tools when the task fits agents, coworkers, tasks, or jobs.

## Authentication

- `SOKOSUMI_API_KEY` is a user API key.
- `SOKOSUMI_AUTH_TOKEN` is an OAuth access token, not an API key.
- Both become `Authorization: Bearer <value>` headers. If both are set, `SOKOSUMI_API_KEY` wins.
- Keep credentials in the environment. Never put them in arguments, files, logs, or task descriptions.
- If no credential exists, ask the user to create an API key at `https://app.sokosumi.com/connections`. Never ask for passwords, cookies, magic links, refresh tokens, or client secrets.

API-key input can use the environment or stdin:

```bash
export SOKOSUMI_API_KEY="$USER_PROVIDED_API_KEY"
sokosumi agents list --json
printf '%s\n' "$SOKOSUMI_API_KEY" | sokosumi auth login --api-key-stdin --json
```

Use `--preprod` only when the user explicitly requests preprod testing and provides a preprod key.

## Commands

```bash
sokosumi discover --json
sokosumi agents list --search "code review" --json
sokosumi agents hire AGENT_ID --input-file ./payload.json --max-credits 25 --json
sokosumi coworkers list --scope available --search "QUERY" --capability tasks --json
sokosumi coworkers register --name "Nexus" --base-url "https://nexus.example.com/v1" --capability chat --capability tasks --json
sokosumi tasks create --coworker-id COWORKER_ID --name "Task title" --description "Task brief" --status READY --json
sokosumi tasks get TASK_ID --json
sokosumi tasks events TASK_ID --json
sokosumi tasks jobs TASK_ID --json
sokosumi tasks comment TASK_ID --comment "TEXT" --json
sokosumi jobs list --json
sokosumi jobs get JOB_ID --details --json
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"..."}' --json
```

Use `--metadata-json` or `--metadata-file` for coworker metadata. Use repeated `--channel provider=value` options for channel metadata. Text API-key output is masked. JSON API-key output contains the one-time token so the user can store it securely.

## Skill routing

- **REQUIRED SUB-SKILL:** Use `coworker` for coworker selection, task creation, input requests, feedback, and completion.
- Use `watch` for polling a running task or job.
- Use `agents` for direct marketplace-agent work.
- Use `tasks` and `jobs` as focused command references.

## Endpoint map

- `GET /v1/users/me`
- `GET /v1/categories`
- `GET /v1/agents`
- `GET /v1/agents/:agentId/input-schema`
- `POST /v1/agents/:agentId/jobs`
- `GET /v1/coworkers`
- `GET /v1/coworkers/:coworkerId`
- `POST /v1/tasks`
- `GET /v1/tasks`
- `GET /v1/tasks/:taskId`
- `GET /v1/tasks/:taskId/jobs`
- `GET /v1/tasks/:taskId/events`
- `POST /v1/tasks/:taskId/events`
- `GET /v1/jobs`
- `GET /v1/jobs/:jobId`
- `GET /v1/jobs/:jobId/events`
- `GET /v1/jobs/:jobId/files`
- `GET /v1/jobs/:jobId/links`
- `GET /v1/jobs/:jobId/input-request`
- `POST /v1/jobs/:jobId/inputs`

## Guardrails

- Never write API keys, OAuth tokens, refresh tokens, or client secrets to files, commits, or logs.
- Never pass secrets in argv.
- Never launch the Ink TUI during automation.
- Use only returned Sokosumi data. Do not invent agent capabilities, required fields, sources, or outputs.
- Ask before sending sensitive task content to an external agent or coworker.
- Use `apps/cli` as the canonical CLI source. Do not use a second sibling CLI.
