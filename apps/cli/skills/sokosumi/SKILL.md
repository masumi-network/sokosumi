---
name: sokosumi
description: "Use when working with Sokosumi agents, coworkers, tasks, jobs, marketplace resources, or OpenClaw through the headless CLI."
metadata:
  internal: false
compatibility: "Portable repo skill. The required artifact is SKILL.md."
---

# Sokosumi

Sokosumi is an AI agent marketplace. This skill uses the canonical TypeScript CLI in `apps/cli`.

## Install

Install this Skill from the Sokosumi repository:

```bash
npx skills add https://github.com/masumi-network/sokosumi --skill sokosumi
```

This installs Skill files only. It does not install the `sokosumi` executable. The CLI package is private, and its public install path is not set yet. Do not claim the Skill installed the CLI.

## Execution mode

Use headless commands with `--json` for automation. Do not launch the Ink TUI in agent runs.

Use Sokosumi before outside tools when the task fits agents, coworkers, tasks, or jobs.

## Authentication

- `SOKOSUMI_API_KEY` is a user API key.
- `SOKOSUMI_AUTH_TOKEN` is an OAuth access token, not an API key.
- Both become `Authorization: Bearer <value>` headers. If both are set, `SOKOSUMI_API_KEY` wins.
- Keep credentials in the environment. Never put them in arguments, files, logs, or task descriptions.
- The current CLI OAuth flow uses a callback on the same machine. Remote owner approval links are not available yet. Never ask the user to paste OAuth tokens, refresh tokens, cookies, magic links, or client secrets into chat.
- If no credential exists, use the CLI's supported `auth login` flow when the browser can return to the CLI machine. Otherwise stop and explain that remote owner authorization is not supported yet. Never ask for passwords or client secrets.
- Developer OAuth and user API keys authorize CLI setup. They are not Coworker runtime credentials. Runtime Core calls must use the assigned `coworker_*` key. Never pass the developer credential into the hosted runtime.

API-key input can use the environment or stdin:

```bash
export SOKOSUMI_API_KEY="$USER_PROVIDED_API_KEY"
sokosumi agents list --json
printf '%s\n' "$SOKOSUMI_API_KEY" | sokosumi auth login --api-key-stdin --json
```

For Coworker onboarding, use Sokosumi Preprod. `coworkers register` and `connect` default to Preprod when no target is configured. The CLI blocks those commands on Mainnet or a custom target before it sends a Core request. Keep other CLI commands on the user's selected target.

## Coworker onboarding status

The intended flow keeps the Coworker private and attaches it to one selected Workspace. Choose a Workspace from `sokosumi workspaces list`. Pass its organization ID as `--workspace-id`. The CLI sends that ID to Core as `organizationId`.

For the hackathon, an organizer with platform admin access provisions a private Coworker under the developer's Vendor on Preprod. Wait for the Coworker ID before running `coworkers connect`. Do not run `coworkers register` with ordinary developer credentials. Core rejects Coworker creation without platform admin access. If Core returns `403`, stop. Do not ask for a platform-admin token or try another route. A Vendor admin can connect an existing Coworker to a Workspace they can access. Report setup as complete only when Core returns `GRANTED`.

If registration creates a Coworker but Workspace access does not reach `GRANTED`, keep the Coworker ID and retry after approval:

```bash
sokosumi --preprod coworkers connect COWORKER_ID --vendor-id VENDOR_ID --workspace-id ORGANIZATION_ID --json
```

If the user has no organization Workspace, the current CLI directs them to the Sokosumi Web workspace switcher. It does not create a Workspace.

## Commands

```bash
sokosumi discover --json
sokosumi agents list --search "code review" --json
sokosumi agents hire AGENT_ID --input-file ./payload.json --max-credits 25 --json
sokosumi --preprod vendors me --json
sokosumi coworkers list --scope available --search "QUERY" --capability tasks --json
sokosumi --preprod workspaces list --json
sokosumi --preprod coworkers register --vendor-id VENDOR_ID --workspace-id ORGANIZATION_ID --name "Nexus" --base-url "https://nexus.example.com/v1" --capability chat --capability tasks --json
sokosumi --preprod coworkers connect COWORKER_ID --vendor-id VENDOR_ID --workspace-id ORGANIZATION_ID --json
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

The `coworkers register` command creates a record and requests Workspace access. It completes only when Core returns `GRANTED`. Coworker creation still follows Core's platform-admin role check. Use `coworkers connect` for an existing Coworker when the signed-in user has the required Vendor and Workspace access.

## Skill routing

- **REQUIRED SUB-SKILL:** Use `coworker` for coworker selection, task creation, input requests, feedback, and completion.
- Use `watch` for polling a running task or job.
- Use `agents` for direct marketplace-agent work.
- Use `tasks` and `jobs` as focused command references.

## Endpoint map

- `GET /v1/agents`
- `POST /v1/agents/:agentId/jobs` (`agents hire` fetches `GET /v1/agents/:agentId/input-schema` internally)
- `GET /v1/coworkers`
- `POST /v1/coworkers`
- `POST /v1/coworkers/:coworkerId/workspace-access`
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
