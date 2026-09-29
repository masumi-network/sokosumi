---
name: sokosumi
description: "Use when connecting existing agents to a private Sokosumi Workspace, setting up Coworkers, or working with Tasks and Jobs through the CLI."
metadata:
  internal: false
compatibility: "Portable repo skill. The required artifact is SKILL.md."
---

# Sokosumi

[REPORTED: user product direction, 2026-09-27] The CLI and this Skill support existing agents over time. Start with private Workspace use. Developer onboarding and global listing follow that path. The hackathon is the first milestone. The agent can run on its operator's hardware or cloud host. Hermes is an optional adapter; the common workflow does not depend on a framework.

## Load the Skill and CLI

[VERIFIED: `apps/cli/package.json`] The private package in `apps/cli` builds the `sokosumi` executable. Skill installation and CLI installation are separate. Build this checkout from the repository root with Node.js 24 and its dependencies:

```bash
pnpm build --filter=@masumi_network/sokosumi --cache=local:w
node apps/cli/dist/bin/sokosumi.js --help
```

Configure the host's command tool with that executable's path. Examples below use `sokosumi` as its short name. Load this checkout's `apps/cli/skills/sokosumi/SKILL.md` through the host's existing Skill loader. Keep `references` beside it.

[REPORTED: existing distribution instructions] The repository install command is:

```bash
npx skills add https://github.com/masumi-network/sokosumi --full-depth --skill sokosumi
```

This does not include local changes that have not reached the selected repository version. Do not claim the command installed the CLI. See [distribution details](references/distribution.md). Host installation and execution need their own verification.

Use headless commands with `--json` for automation. Do not open the Ink TUI during an agent run. Use existing user authorization for writes. If it does not cover the intended change, ask before that change. Ask one question at a time.

[VERIFIED: `apps/cli/src/cli/commands/runtime.ts`] For execution of an already assigned Task, use the runtime section directly. Account discovery is the human setup path. Never substitute human OAuth or a user API key for runtime authentication.

## Confirm the account and target

[VERIFIED: `apps/cli/src/cli/index.ts`, `apps/cli/src/cli/auth-whoami.ts`, `apps/cli/src/cli/auth-status.ts`] Human setup uses OAuth or a user API key. Run `auth whoami --json` to verify the account and platform role with Core. `auth status` reports authentication state. Neither output proves permission for every action.

[VERIFIED: `apps/cli/src/auth/auth-manager.ts`, `apps/cli/src/auth/oauth.ts`] The CLI supports OS-vault credentials and explicit environment or stdin input. `SOKOSUMI_API_KEY` takes precedence over `SOKOSUMI_AUTH_TOKEN`; both override saved OAuth credentials. Before switching browser accounts, clear those variables from the shell. Switch the browser's actual account, run `auth login`, then verify `auth whoami`. CLI logout clears local credentials; it does not switch the browser account.

Never request keys, OAuth tokens, cookies, passwords, or client secrets in chat. If authentication is missing, use supported `auth login` when the browser can return to the CLI machine. Otherwise ask the operator to configure supported authentication. Do not invent remote approval links.

[VERIFIED: `apps/cli/src/cli/index.ts`, `apps/cli/src/cli/commands/admin.ts`] Current provisioning, registration, connection, and admin onboarding work on Preprod only. Authentication remains required there. Use `--preprod` for those steps. Other user commands keep the selected target. Runtime commands use a separate Coworker key and fixed Preprod target.

## Discover before creating anything

[VERIFIED: `apps/cli/src/cli/commands/vendors.ts`, `apps/cli/src/cli/commands/workspaces.ts`, `apps/cli/src/cli/commands/coworkers.ts`] Discover the current account's records:

```bash
sokosumi --preprod auth whoami --json
sokosumi --preprod workspaces list --json
sokosumi --preprod vendors me --json
sokosumi --preprod coworkers list --scope owned --json
```

Use returned IDs. Select the intended organization Workspace, Vendor, and existing Coworker. Ask only for a missing name or a choice between suitable records. Reuse an existing administered Vendor. Propose `vendors create --name NAME --slug SLUG` only when discovery finds no suitable one and the user wants a new Vendor.

[VERIFIED: `apps/cli/src/cli/registration-authority.ts`, `apps/cli/src/api/models/organization-workspace.ts`] The current connection command requires an organization Workspace in the caller's memberships. A personal Workspace is not accepted by this path. If no suitable organization exists, use Web to create or join one, then repeat discovery. Do not choose a shared Workspace by default.

[VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`; Core `apps/core/src/routes/v1/coworkers/post.ts`, `apps/core/src/helpers/coworker-workspace-access.ts`]

| Evidence | What it allows in this CLI |
| --- | --- |
| `user.platformRole` includes the exact `admin` role | Platform-admin provisioning and `admin` commands, subject to Core authorization |
| Selected Vendor membership has `role: "admin"` | The Vendor check required by `coworkers connect` |
| Selected organization appears in `workspaces list` | The Workspace membership check required by `coworkers connect` |
| Organization role is `owner` or `admin` | Organization authority; it does not replace platform or Vendor authority |

`coworkers connect` requires both the Vendor and organization checks, including for a platform admin. Do not infer a CLI override from the platform role. Core has a broader platform-admin grant path, but this CLI command performs its own membership preflight.

[VERIFIED: Core `apps/core/src/helpers/vendor-membership.ts`, `apps/core/src/routes/v1/coworkers/get.ts`] The `owned` list includes administered Vendor records and assigned Coworkers. An assignment alone does not satisfy the CLI's Vendor-admin connection check. An empty `available` list under OAuth does not prove an organization has no grant: OAuth defaults to the personal Workspace, and this CLI accepts `--organization-slug` only for Tasks.

## Set up private Workspace use

[VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`] A Coworker record identifies an agent in Sokosumi. Reuse the matching record when it exists. If a record is missing, a signed-in platform admin can provision one under the chosen Vendor:

```bash
sokosumi --preprod coworkers provision --vendor-id VENDOR_ID --name "COWORKER_NAME" --capability tasks --json
```

If the current user lacks platform authority, prepare that command and the non-secret Vendor ID and name for a platform admin. Keep the user's selected records when switching accounts. Do not request an admin token or send a handoff message without authorization.

[VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`] Provisioning checks live platform role and verifies the returned Vendor and `isWhitelisted: false`. Keep `handoff.coworkerId` and `handoff.vendorId`. Provisioning does not grant Workspace access or assign the Coworker to a person by email. Vendor admins can manage their Vendor's Coworkers.

With the required Vendor and organization memberships, connect the record:

```bash
sokosumi --preprod coworkers connect COWORKER_ID --vendor-id VENDOR_ID --workspace-id ORGANIZATION_ID --json
sokosumi --preprod workspaces check ORGANIZATION_ID --json
```

Require `GRANTED` before reporting connection success. Preserve the Coworker ID when creation succeeds but access fails. Inspect state before retrying an uncertain write. Preserve Core's status and reason; a generic `403` does not identify its cause. Do not switch identities or try another route to bypass a denial.

[VERIFIED: Core `apps/core/src/routes/v1/coworkers/get.ts`, `apps/core/src/helpers/coworker-workspace-access.ts`; `CONTEXT.md:250-254`] Private use limits Workspace selection through grants. It does not make the Coworker profile invisible to all other users. Members of a granted Workspace can select it. Organization credits form a shared pool; a Seat is not a private spending allowance. Review the intended membership and grants before calling the setup private.

[VERIFIED: `apps/cli/src/cli/commands/workspaces.ts`, `apps/cli/src/cli/commands/admin.ts`] `taskSeatEligible` checks the caller's Seat policy only. It does not verify credits, Coworker grants, or runtime readiness. If false, pause organization Task creation and execution. Continue authorized record setup and runtime-key preparation. Capacity and subscriptions remain Web work; the CLI does not purchase or reassign Seats.

## Run an assigned Task with the existing agent

[VERIFIED: `apps/cli/src/cli/commands/runtime.ts`, `apps/cli/src/coworker/runtime-credentials.ts`] The agent needs a command tool that can run the CLI and write a result file. The operator supplies Coworker, organization, and Task IDs. The operator configures a Coworker-scoped OS-vault key through `runtime key-import`, or a trusted wrapper supplies it through stdin for each command. Never request the key in chat or expose it through model-visible output. Never inspect credential stores or mint keys from runtime instructions. Ask the operator to configure missing runtime authentication.

1. Start the operator's selected Task:

   ```bash
   sokosumi runtime start TASK_ID --coworker-id COWORKER_ID --organization-id ORGANIZATION_ID --json
   ```

2. Require `RUNNING`. Read the returned Task name and description. Use the agent's existing model, tools, and configuration to do that work.
3. Write the finished answer to a UTF-8 text file, at most 1 MiB. Keep credentials out of the result.
4. Submit it once:

   ```bash
   sokosumi runtime complete TASK_ID --coworker-id COWORKER_ID --organization-id ORGANIZATION_ID --result-file ./result.txt --json
   ```

5. Report completion only after `COMPLETED` and a confirmed event ID. On failure, stop for operator inspection before any retry.

[VERIFIED: `apps/cli/src/coworker/runtime-task.ts`, `apps/cli/src/api/http-client.ts`] Runtime calls use only the Coworker credential on Preprod. Start and completion check the assigned Coworker, organization, and Task status. Run one executor per Task. This flow does not create a worker lease, poll for automatic work, or install an agent host. An MCP-only host needs a separate transport adapter.

## Create and inspect organization Tasks

[VERIFIED: `apps/cli/src/cli/index.ts`, `apps/cli/src/api/http-client.ts`; Core `apps/core/src/middleware/organization.ts`] Human Task commands use the Workspace slug. Keep it on every organization Task call. Core checks membership and Task permissions. The flag preserves the selected network. Without it, OAuth uses the personal Workspace; browser Workspace selection does not change that context.

```bash
sokosumi --preprod tasks create --organization-slug WORKSPACE_SLUG --coworker-id COWORKER_ID --name "Task title" --description "Approved Task brief" --status READY --json
sokosumi --preprod tasks get TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi --preprod tasks events TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi --preprod tasks jobs TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi --preprod tasks comment TASK_ID --organization-slug WORKSPACE_SLUG --comment "TEXT" --json
```

Confirm the intended brief and write authorization before creating work. Keep one watcher and report each event once. For Task `INPUT_REQUIRED`, show the clarification and ask for the human's answer. Submit that answer once with `tasks comment`; do not change status. If a linked Job has `inputRequest`, use the Job flow below instead.

## Developer onboarding when requested

[REPORTED: user product direction, 2026-09-27] Adding developers follows the private Workspace path. Do not require invitations, new Vendors, or a shared organization for someone setting up their own existing agent.

[VERIFIED: `apps/cli/src/cli/commands/admin.ts`, `apps/cli/src/api/services/admin-workspace-service.ts`] A platform admin can add an existing account and assign available Seat capacity:

```bash
sokosumi --preprod admin members WORKSPACE_SLUG --json
sokosumi --preprod admin add-member WORKSPACE_SLUG --email USER_EMAIL --json
sokosumi --preprod admin assign-seat WORKSPACE_SLUG --email USER_EMAIL --json
```

The account must already exist. Email lookup does not select that user's Vendor. Ask the recipient to discover their Vendor and Workspace first. Existing membership and roles remain unchanged. Free members need no Seat assignment. Paid members use available capacity or keep their current assignment. Return the chosen Coworker and Vendor IDs with the organization ID and slug. The recipient or trusted operator keeps the runtime key.

## Marketplace Agents and Jobs

[VERIFIED: `apps/cli/src/cli/commands/agents.ts`, `apps/cli/src/cli/commands/jobs.ts`] These user commands keep the selected target. Confirm the deliverable and credit cap before hiring:

```bash
sokosumi agents list --search "SPECIALTY" --json
sokosumi agents hire AGENT_ID --input-file ./payload.json --max-credits 25 --json
sokosumi jobs get JOB_ID --details --json
sokosumi jobs input JOB_ID --event-id EVENT_ID --input-file ./answer.json --json
```

`agents hire` reads the input schema. Do not guess required fields. For a Job `inputRequest`, show its `eventId`, `message`, and `inputSchema`. Ask for one matching non-empty JSON object, submit it once, then read the Job again. Keep the selected target; Job commands do not accept the Task Workspace flag. Report final status and returned outputs rather than an intermediate event.

## Optional focused Skills and later work

The main workflow is self-contained. Use `coworker`, `tasks`, `jobs`, `agents`, or `watch` only when that focused Skill is installed. Installing this Skill does not establish their presence. `watch` is a Skill, not a CLI command.

[REPORTED: user product direction, 2026-09-27] Framework adapters are optional. Private Workspace setup comes before the developer distribution flow and global listing. Payment submission and global approval remain separate work. Do not invent commands for them or claim seller receipt from Task completion.
