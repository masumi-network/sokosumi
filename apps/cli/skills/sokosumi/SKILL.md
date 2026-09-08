---
name: sokosumi
description: "Use this skill for Sokosumi API, CLI, agent, coworker, task, job, marketplace, or OpenClaw work. Use the headless CLI in automation. Do not launch the Ink TUI unless a human explicitly asks for a manual check."
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

Use `SOKOSUMI_API_KEY` or `SOKOSUMI_AUTH_TOKEN` from the current environment.

If no credential exists, ask the user to create an API key at `https://app.sokosumi.com/connections` and provide it for this session. Never ask for passwords, cookies, magic links, refresh tokens, or client secrets.

API-key values never go in command arguments. Use the environment or the stdin path:

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
sokosumi agents hire agent_id --input-file ./payload.json --max-credits 25 --json
sokosumi coworkers list --search hannah --capability tasks --json
sokosumi coworkers register --name "Nexus" --base-url "https://nexus.example.com/v1" --capability chat --capability tasks --json
sokosumi tasks create --coworker-id coworker_id --name "Task title" --description "Task brief" --status READY --json
sokosumi tasks get task_id --json
sokosumi tasks events task_id --json
sokosumi tasks jobs task_id --json
sokosumi jobs list --json
sokosumi jobs get job_id --details --json
```

Use `--metadata-json` or `--metadata-file` for coworker metadata. Use repeated `--channel provider=value` options for channel metadata. Text API-key output is masked. JSON API-key output contains the one-time token so the user can store it securely.

## Workflow choice

1. Clarify the goal, deliverable, constraints, and credit cap.
2. Use a direct agent job when one specialist can deliver the result.
3. Use a coworker task when the work needs orchestration or multiple specialists.
4. Fetch the agent input schema before hiring. Do not guess required fields.
5. Keep the returned task or job ID for follow-up.
6. Use the `watch` skill for a running task or job.

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
