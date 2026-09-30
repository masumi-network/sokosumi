# Sokosumi CLI

Published npm package [`@masumi_network/sokosumi`](https://www.npmjs.com/package/@masumi_network/sokosumi); package path `apps/cli`; binary `sokosumi`. Lives in this monorepo. Product intent is [`VISION.md`](./VISION.md). Contract is [`SPEC.md`](./SPEC.md).

## Product direction

[CORRECTION, REPORTED: user product direction, 2026-09-27]
The CLI and its Skill are a continuing integration for existing agents. Private Workspace setup is the first path.
Developer onboarding and global listing follow that path. The hackathon is the first milestone, not the architecture.
The agent can stay on its operator's hardware or cloud host. Hermes is an optional adapter.

[VERIFIED: `src/cli/commands/coworkers.ts`, `src/cli/registration-authority.ts`]
Discover existing Workspaces, Vendors, and Coworkers before proposing a new record. Reuse suitable records.
The current path uses a selected organization Workspace on Preprod. It does not accept a personal Workspace for connection.
Core still requires platform-admin authority to create a Coworker. CLI connection requires Vendor-admin and organization membership.
Platform-admin status does not bypass those CLI connection checks. See the [role-aware Skill](skills/sokosumi/SKILL.md).

[REPORTED: first milestone] Prove a real Task with the existing agent before broadening the flow.
[OPEN] Live runtime execution remains unverified. `runtime receipt` reads the seller receipt, but no live Task has proven it yet. Payment submission and global publication remain separate work.
The [implementation plan](docs/developer-cli-implementation-plan.md) retains the milestone history.

### Private Workspace setup and platform-admin handoff

[VERIFIED: source only] Web has Workspace creation and developer invitations.
Use the Workspace switcher to create or select the organization, then invite the intended developers.

[CORRECTION, VERIFIED: `src/cli/registration-authority.ts:53-71`, `../../CONTEXT.md:250-254`]
The earlier shared-Workspace wording described the pilot setup. The CLI accepts any selected organization in the caller's memberships.
A shared organization has a shared credit pool. A Seat does not give each developer a separate credit allowance.
See the [creation wizard](../web/src/components/organizations/create-organization-wizard/create-organization-wizard.tsx)
and [invitation form](../web/src/components/organizations/organization-member-invite/form.tsx).

[VERIFIED: `src/cli/commands/admin.ts`, `src/api/services/admin-workspace-service.ts`]
When adding another user, a platform admin can add their existing Preprod account and assign an available Seat.
These member commands are optional for private setup with the current account.
Use the selected Workspace's slug. Organization admin alone does not satisfy the CLI's platform-admin check.
Core authorizes each request.

```bash
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod auth whoami --json
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod admin members WORKSPACE_SLUG --json
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod admin add-member WORKSPACE_SLUG --email DEVELOPER_EMAIL --json
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod admin assign-seat WORKSPACE_SLUG --email DEVELOPER_EMAIL --json
```

[VERIFIED: `src/cli/commands/admin.ts`, `src/api/services/admin-workspace-service.ts`]
`admin members` returns the organization ID as `workspace.id`, its slug, members, and Seat counts.
`add-member` matches the exact email across paginated results and adds role `member`.
It preserves existing membership and roles. It does not create accounts, send invitations, or grant Vendor access.
Free Workspace members need no Seat assignment. Paid Workspaces use available capacity or keep the existing Seat assignment.
The CLI does not purchase Seats or reassign another member's Seat. Capacity changes remain in Web billing.
If a write reports uncertain completion, inspect `admin members` before retrying.
Coworker provisioning and connection can continue when no Seat is available.

[VERIFIED: `src/cli/commands/coworkers.ts`] Discover existing records first. Provision only when the intended Coworker is missing.
A platform admin uses the chosen Vendor ID and final name. A user without that role needs a platform-admin handoff.
Confirm the intended account before provisioning:

```bash
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod auth login
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod auth whoami --json
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod coworkers provision --vendor-id VENDOR_ID --name "Workspace Coworker" --capability tasks --json
```

[VERIFIED: `src/api/models/user-identity.ts`, `src/cli/commands/coworkers.ts`]
`provision` checks the live account for the exact `admin` role before creation. Core still authorizes the request.
The CLI verifies that the returned Coworker belongs to the requested Vendor and has `isWhitelisted: false`.
If creation cannot be confirmed, inspect the Coworker list before retrying. Core errors retain their status and request details.

[CORRECTION, VERIFIED: `src/cli/commands/coworkers.ts`] The handoff now includes both `handoff.coworkerId` and `handoff.vendorId`.
Keep these IDs with the selected organization ID and Workspace slug. If provisioning for someone else, give them these non-secret IDs.
The connecting account uses `coworkers connect` below and must have the required Vendor and organization memberships.
Provisioning itself does not require those memberships. The trusted operator creates and keeps the runtime key.
[VERIFIED: `../core/src/routes/v1/coworkers/coworker-management-access.ts`] Vendor admins can manage the Vendor's Coworkers.
Provisioning under a Vendor does not assign the Coworker to a person by email.

[VERIFIED: source only, `apps/core/src/routes/v1/coworkers/post.ts:77-80,110-135`]
Core checks platform admin access and Vendor existence, then creates the Coworker with `isWhitelisted: false`.
Provisioning does not grant Workspace access. Private profiles are still returned by Core's
`scope=all` list; private means restricted Workspace selection here.
[List route](../core/src/routes/v1/coworkers/get.ts)
[OPEN] The complete runtime flow still needs a live Preprod test.

[CORRECTION, VERIFIED: `src/cli/commands/runtime.ts`, `src/coworker/runtime-credentials.ts`, `src/coworker/runtime-task.ts`]
The earlier README listed runtime execution as planned work. An existing agent can now start and complete an assigned Task.
Runtime commands use a separate Coworker credential on Preprod. Live Task execution and a live seller receipt remain unverified.
See the [agent runtime pilot](docs/agent-runtime-pilot.md), [ADR 0004](docs/adr/0004-coworker-capabilities-and-graduation.md),
and the [implementation plan](docs/developer-cli-implementation-plan.md).

[VERIFIED: `src/cli/commands/runtime.ts`, `src/coworker/hermes-runtime.ts`]
The optional `runtime run` command starts one Task with the operator's existing Hermes profile.
It keeps that profile's model and tools, unless the operator supplies model or provider overrides.
See the [Hermes pilot](docs/hermes-preprod-pilot.md). Live Hermes execution remains unverified.

Install the framework-neutral Skill from the repository:

```bash
npx skills add https://github.com/masumi-network/sokosumi --full-depth --skill sokosumi
```

This installs Skill files only. It does not install the CLI executable, which is published to npm as `@masumi_network/sokosumi` (`npm i -g @masumi_network/sokosumi`, or run without installing via `npx @masumi_network/sokosumi`).

## Run

From the repo root, after `pnpm install`:

```bash
pnpm sokosumi
```

Or:

```bash
pnpm --filter @masumi_network/sokosumi sokosumi
```

That opens the Ink screen. Choose a sign-in method with Up and Down, then press Enter. Use Esc to go back and q to quit. Choose browser OAuth or a user API key. Signed-in home lists Vendors, Workspaces, and Sign out. Use the headless commands below to register or connect a Coworker. OAuth opens Core `/signin`. Stored OAuth credentials and user API keys use the OS vault. Linux persistent auth needs Secret Service. If no vault is available, use `SOKOSUMI_API_KEY` or stdin for the current run.

Headless:

```bash
pnpm --filter @masumi_network/sokosumi sokosumi -- discover --json
pnpm --filter @masumi_network/sokosumi sokosumi -- agents list --json
pnpm --filter @masumi_network/sokosumi sokosumi -- agents hire AGENT_ID --input-json '{"query":"hello"}' --json
pnpm --filter @masumi_network/sokosumi sokosumi -- coworkers list --json
pnpm --filter @masumi_network/sokosumi sokosumi -- tasks list --json
pnpm --filter @masumi_network/sokosumi sokosumi -- jobs list --json
pnpm --filter @masumi_network/sokosumi sokosumi -- jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"yes"}' --json
pnpm --filter @masumi_network/sokosumi sokosumi -- auth login --json
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod auth whoami --json
printf '%s\\n' "$SOKOSUMI_API_KEY" | pnpm --filter @masumi_network/sokosumi sokosumi -- auth login --api-key-stdin --json
SOKOSUMI_API_KEY=soko_preprod_... pnpm --filter @masumi_network/sokosumi sokosumi -- auth status --json
pnpm --filter @masumi_network/sokosumi sokosumi -- auth logout
```

Connect the selected existing or newly provisioned Coworker with the required Vendor and organization memberships:

```bash
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod coworkers connect COWORKER_ID --vendor-id VENDOR_ID --workspace-id ORGANIZATION_ID --json
```

[VERIFIED: `src/cli/commands/workspaces.ts`, `src/api/services/organization-workspace-service.ts`]
Before organization Task creation, check the account's Seat eligibility:

```bash
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod workspaces check ORGANIZATION_ID --json
```

[VERIFIED: `src/cli/commands/workspaces.ts`]
`taskSeatEligible` reports the caller's Seat policy result. It does not prove credits, Coworker access, or runtime readiness.
When false, a platform admin can assign available capacity with `admin assign-seat`.
An organization owner or admin handles additional capacity in Web billing.

[VERIFIED: `src/cli/index.ts`, `src/api/http-client.ts`; Core `../core/src/middleware/auth.ts`, `../core/src/middleware/organization.ts`]
Use `--organization-slug WORKSPACE_SLUG` on each organization `tasks` command.
The CLI sends `X-Organization-Slug`; Core checks membership and Task permissions.
The flag preserves the selected API target. Without it, Core uses the credential's default context.
OAuth defaults to the personal Workspace. Selecting a Workspace in the browser does not change the CLI OAuth context.

```bash
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod tasks create --organization-slug WORKSPACE_SLUG --coworker-id COWORKER_ID --name "Pilot Task" --description "Approved Task brief" --status READY --json
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod tasks get TASK_ID --organization-slug WORKSPACE_SLUG --json
pnpm --filter @masumi_network/sokosumi sokosumi -- --preprod tasks events TASK_ID --organization-slug WORKSPACE_SLUG --json
```

[VERIFIED: `src/cli/index.ts`]
Task commands reject `--organization-id` and `--workspace-id` before authentication. Use the Workspace slug instead.
Other command families reject `--organization-slug`. Connection and Seat checks still take the organization ID.

Use the organization ID from `workspaces list` as `--workspace-id`. Coworker
`provision`, `register`, and `connect` use Preprod by default when no target is configured.
These commands work on Preprod only. `coworkers register` requires platform admin
access. That command creates the Coworker, then asks Core to grant Workspace
access. It also requires the caller to administer the Vendor and belong to the Workspace.
Use `provision` for a platform-admin creation step under the selected Vendor.
`register` reports success only when Core returns `GRANTED`. If the Coworker
record is created but access is pending or fails, retry with `coworkers connect`.
Core keeps its existing role checks. `coworkers connect` attaches an existing
record through the Core access route. It accepts command options for JSON fields. `tasks create`
and `tasks comment` also accept command options for JSON fields. Use
`--metadata-json` or `--metadata-file` for coworker metadata. Use
`--channel provider=value` to add coworker channel metadata. The
`coworkers api-key` command prints a masked token in text mode and returns the
one-time token only in JSON mode.

Use `jobs input JOB_ID --event-id EVENT_ID` with `--input-json` or `--input-file` to submit a pending job input request; the command also supports `--json`.

[VERIFIED: `src/cli/auth-whoami.ts`, `src/cli/auth-status.ts`, `src/cli/auth-logout.ts`, `src/auth/auth-manager.ts:51-57`]
After login, run `auth whoami` on the selected target to confirm the account email and platform role with Core.
`auth status` reports authentication state. Before switching browser accounts, clear `SOKOSUMI_API_KEY` and `SOKOSUMI_AUTH_TOKEN` from the shell.
These environment credentials override saved OAuth credentials. Sign in as the intended account in the browser.
Then run CLI `auth login` and `auth whoami`. CLI `auth logout` clears local credentials; it does not switch the browser account.

Target-coded user API keys select mainnet or preprod locally. Legacy keys need `--preprod` or `--api-url`. API keys never go in command arguments.

## Execute an assigned Task

[VERIFIED: `src/cli/commands/runtime.ts`, `src/coworker/runtime-credentials.ts`]
Use the existing agent's command tool on its current host. Import the Coworker key through an operator's secret reader.
Set `OPERATOR_SECRET_READER` to that reader's executable path. Keep the key out of arguments, chat, logs, and plaintext files.

```bash
"$OPERATOR_SECRET_READER" | sokosumi runtime key-import --coworker-id COWORKER_ID --api-key-stdin --json
sokosumi runtime start TASK_ID --coworker-id COWORKER_ID --organization-id ORGANIZATION_ID --json
sokosumi runtime complete TASK_ID --coworker-id COWORKER_ID --organization-id ORGANIZATION_ID --result-file ./result.txt --json
sokosumi runtime receipt TASK_ID --coworker-id COWORKER_ID --json
```

[VERIFIED: `src/cli/commands/runtime.ts`, `src/coworker/runtime-task.ts`]
Import verifies the active Coworker's identity and Task capability before storing the key in its OS-vault entry.
Start requires the assigned `READY` Task and reports `RUNNING` after Core confirms the change.
The agent performs the work and writes its finished answer to `result.txt` as UTF-8 text, at most 1 MiB.
Complete verifies the assignment and `RUNNING` state, then submits the result and requires a confirmed completion event.
Run one executor per Task. Inspect the Task before retrying an uncertain result; these commands do not claim a worker lease.

[VERIFIED: `src/cli/commands/runtime.ts`, `../core/src/helpers/coworker-task-receipt.ts`]
Receipt reads the Task's payment claim through Core. `settled` is true only when the payment reached the seller on-chain.
That means `onChainState` `Withdrawn`, or `DisputedWithdrawn` with a seller payout. Only a settled receipt carries a `txHash`, and even then it can be null.
`settled: false` is a valid answer and exits 0. Core answers 502 when the payment node fails, so an outage never reads as unpaid.

[VERIFIED: `src/cli/commands/runtime.ts`, `src/api/http-client.ts`]
Runtime calls use only a Coworker key on Preprod. They do not use developer authentication or configured API targets.
On hosts without an OS vault, the operator supplies `--api-key-stdin` for each operation through the secret reader.
The [pilot guide](docs/agent-runtime-pilot.md) covers host setup and verification. Live execution remains unproven.

## Configuration

The CLI reads non-secret preferences from `~/.sokosumi/config.json`:

```json
{
  "apiUrl": "https://api.sokosumi.com",
  "authUrl": "https://api.sokosumi.com/auth",
  "webUrl": "https://sokosumi.com",
  "mainnetOAuthClientId": "public-mainnet-client",
  "preprodOAuthClientId": "public-preprod-client"
}
```

Do not put API keys, OAuth tokens, refresh tokens, or client secrets in this file. The CLI ignores those fields. The file is optional.

Configuration precedence is flags, process environment, home preferences, local `.env`, then built-in defaults. The CLI reads `.env` from the current directory and `apps/cli/.env` when present. Hosted targets have built-in registered public IDs: mainnet `GxmewjdHVAaqUEglxWdyCqVFvnTASycj`, preprod `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR`; hosted OAuth uses Core auth at `<selected-api-url>/auth` (custom `authUrl` remains an override). Local `.env`, home config, and environment values remain optional overrides. Set `SOKOSUMI_MAINNET_OAUTH_CLIENT_ID`, `SOKOSUMI_PREPROD_OAUTH_CLIENT_ID`, generic `SOKOSUMI_OAUTH_CLIENT_ID`, or pass `--client-id` only when you need a different registered client.

## Build from source

npm publication is disabled for this workspace package. Use the source commands above.

To run the built binary directly:

```bash
pnpm --filter @masumi_network/sokosumi build
node apps/cli/dist/bin/sokosumi.js --help
```


Local Core (with a registered local OAuth client, if using OAuth):

```bash
pnpm --filter @masumi_network/sokosumi sokosumi -- --api-url http://localhost:8787
```
