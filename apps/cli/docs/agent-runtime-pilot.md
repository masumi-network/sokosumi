# Existing-agent pilot on Preprod

[REPORTED: user direction, 2026-09-27] Keep the developer's existing agent on their machine or cloud host. Use current Core permissions.

## Observed setup, 2026-09-27

[REPORTED: Preprod pilot run by `/root`] Core profile reads distinguished the developer's `role: "user"` from the organizer's `role: "user,admin"`. The organizer provisioned a Coworker under the developer's Vendor. Creation returned `isWhitelisted: false` and `capabilities: ["tasks"]`. After switching back, the developer found the Coworker through `scope=owned` and connected it with `status: "GRANTED"`.

[REPORTED: the same pilot] The developer's organization membership already existed. The organizer did not add it. The inspected member had `seatAssignedAt: null`. The organization returned `billingPlan.plan: "pro"`; its Seat summary returned `purchasedSeats: 1`, `assignedCount: 1`, and `unusedSeats: 0`.

[CORRECTION, REPORTED: built CLI checks run by `/root`, 2026-09-27] The earlier record had no direct `workspaces check` result. Both commands below now exited `0` against Preprod. Identity output included `user.platformRole: "user"`, `target: "preprod"`, and `apiUrl: "https://api.preprod.sokosumi.com"`. The Seat result included `taskSeatEligible: false` for the selected pilot organization. Personal identifiers are omitted. These reads confirm the current Seat blocker; they did not change roles, memberships, Seats, grants, or billing.

```sh
node apps/cli/dist/bin/sokosumi.js --preprod auth whoami --json
node apps/cli/dist/bin/sokosumi.js --preprod workspaces check ORGANIZATION_ID --json
```

`ORGANIZATION_ID` above replaces the actual pilot ID used in the check.

[REPORTED: the same pilot] Only setup was tested. Task runtime, model/provider execution, payment submission, and seller receipt remain unproven. Resolve the Seat prerequisite before organization Task creation and execution. This single setup result does not establish isolation between participants.

[CORRECTION, VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`, `apps/cli/src/cli/commands/runtime.ts`] The earlier guide paused the whole pilot for Seat capacity. That ordering was unnecessary. Authorized provisioning, connection, host setup, and operator runtime-key preparation can continue. Prepare the host and runtime authentication below while the user handles subscription capacity separately in Web.

[REPORTED: implementation session by `/root`, 2026-09-27] No live member addition, Seat assignment, invitation, or billing change was performed during this implementation. The observed Seat blocker remains open.

## 1. Prepare one assigned Task

[VERIFIED: `apps/cli/src/cli/auth-whoami.ts`; Core `apps/core/src/middleware/auth.ts`] OAuth signs in the account; Core checks authorization on each request. `auth whoami` reads the signed-in platform role. Platform admin, Vendor admin, and organization admin are separate roles. There is no `--role` override. An admin may also follow the developer path for their own agent. The role does not authorize unrelated writes.

### Developer: discover your records

[VERIFIED: `apps/cli/src/cli/auth-whoami.ts`, `apps/cli/src/cli/commands/vendors.ts`, `apps/cli/src/cli/commands/workspaces.ts`, `apps/cli/src/cli/commands/coworkers.ts`] Operators can run setup on their laptops. Use the built CLI described below. Authenticate as the developer, confirm the account, and discover existing records:

```sh
sokosumi --preprod auth login
sokosumi --preprod auth whoami --json
sokosumi --preprod vendors me --json
sokosumi --preprod workspaces list --json
sokosumi --preprod coworkers list --scope owned --json
```

Use the returned IDs. Choose your administered Vendor and selected Workspace. Use a separate Vendor for each developer, without a shared default. Ask one question at a time if the Vendor, Workspace, or Coworker name needs a choice.

If no owned Coworker supports Tasks, suggest organizer provisioning. Give the organizer your account email, Vendor ID, and final Coworker name. If you need a Vendor, use `vendors create` under the authorized scope first. Wait for the Coworker ID and selected Workspace details, or discover the record through `coworkers list --scope owned` after provisioning.

### Platform admin: prepare membership and Seats

[VERIFIED: `apps/cli/src/auth/oauth.ts`, `apps/cli/src/auth/auth-manager.ts`; Core `apps/core/src/routes/v1/coworkers/post.ts:79`] Sign in as the platform admin and confirm the account with `auth whoami`. Before switching browser accounts, clear `SOKOSUMI_API_KEY` and `SOKOSUMI_AUTH_TOKEN` from the shell. These credentials override saved OAuth credentials. Switch the browser's actual Web session, then run CLI login again. CLI logout only clears local credentials.

[VERIFIED: `apps/cli/src/cli/commands/admin.ts`, `apps/cli/src/api/services/admin-workspace-service.ts`] The admin commands work only on Preprod and require a live platform-admin identity. An organization admin role alone does not satisfy this check. Core still authorizes each request. Use the selected organization's slug and the existing developer account's exact email:

```sh
sokosumi --preprod admin members WORKSPACE_SLUG --json
sokosumi --preprod admin add-member WORKSPACE_SLUG --email DEVELOPER_EMAIL --json
sokosumi --preprod admin assign-seat WORKSPACE_SLUG --email DEVELOPER_EMAIL --json
```

Run the writes only under the user's authorization. `admin members` returns `workspace.id` as the organization ID, plus its slug and Seat counts. Keep both values. `add-member` resolves the exact email across paginated results and adds an existing account with role `member`. It does not create an account or send an invitation. If lookup fails, the developer must sign in to Preprod first. Existing membership is returned without changing its role.

`assign-seat` uses available paid capacity. It returns an existing assignment without writing. Free members already meet the Seat policy, so it returns `seatAssignment: "not-required"`. If no paid Seat is available, stop that assignment and continue provisioning below. The user handles subscription capacity separately in Web. The CLI does not purchase or reassign Seats. If a write reports uncertain completion, inspect `admin members` before retrying.

### Platform admin: create under the developer's Vendor

Use the Vendor ID supplied by the developer. The admin's `vendors me` result is not a recipient lookup. This flow does not assign a Coworker to a person by email. Confirm the developer's Vendor ID and final name in the command. Use existing write authorization when it covers the command; otherwise request it:

```sh
sokosumi --preprod coworkers provision --vendor-id VENDOR_ID --name NAME --capability tasks --json
```

[VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`, `apps/cli/src/cli/commands/admin.ts`] Provisioning requires `admin` in the live account's comma-separated role list. The check ignores letter case and spaces around each role. Core still authorizes the create request. The CLI verifies the returned Vendor and `isWhitelisted: false`. JSON includes `handoff: { coworkerId, vendorId }`. Return these non-secret IDs, the organization ID, and the Workspace slug to the developer. Do not create their runtime key.

[VERIFIED: `apps/core/src/routes/v1/coworkers/coworker-management-access.ts`] A Vendor's admins can manage its Coworkers. Creation under that Vendor does not create a per-user assignment or Workspace grant.

### Developer: connect and check Task Seats

Use the developer account. Before switching browser accounts, clear `SOKOSUMI_API_KEY` and `SOKOSUMI_AUTH_TOKEN` from the shell. Switch its Web session back, then repeat CLI login and `auth whoami`. Use the handoff IDs or find the provisioned Coworker with `coworkers list --scope owned --json`. Check its Vendor against your administered Vendor, then connect it to the selected Workspace:

```sh
sokosumi --preprod coworkers connect COWORKER_ID --vendor-id VENDOR_ID --workspace-id ORGANIZATION_ID --json
```

[VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`; `apps/cli/src/cli/commands/workspaces.ts`] Require `GRANTED`, then check the developer's Task Seat eligibility:

```sh
sokosumi --preprod workspaces check ORGANIZATION_ID --json
```

`taskSeatEligible` checks Seat policy only. It does not verify credits, Coworker grants, or runtime readiness. If false, ask an organization owner or admin to resolve Seat assignment or capacity. Do not purchase or reassign Seats without approval. The connection command does not perform this check or assign a Seat.

[CORRECTION, VERIFIED: `apps/cli/src/cli/index.ts`, `apps/cli/src/api/http-client.ts`; Core `apps/core/src/middleware/organization.ts`] The earlier guide required Web for organization Task creation. The CLI now accepts `--organization-slug` on every `tasks` command. Once the Seat prerequisite is met, create one approved Task in the selected Workspace:

```sh
sokosumi --preprod tasks create --organization-slug WORKSPACE_SLUG --coworker-id COWORKER_ID --name "Pilot Task" --description "Approved Task brief" --status READY --json
sokosumi --preprod tasks get TASK_ID --organization-slug WORKSPACE_SLUG --json
```

Use the returned Task ID. Require the intended Coworker, organization, and `READY` status. Core receives `X-Organization-Slug` and checks membership and Task permissions. Without the flag, OAuth uses the personal Workspace. Browser Workspace selection does not select the CLI's OAuth Task context. Keep the slug on later user Task reads and comments. Review credits separately before a paid operation.

[VERIFIED: `apps/cli/src/cli/index.ts`, `apps/cli/src/cli/commands/runtime.ts`] Admin commands and user Task selection use the Workspace slug. `coworkers connect --workspace-id`, `workspaces check`, and runtime `--organization-id` use the organization ID. The Task flag does not change the selected target and is rejected outside the `tasks` command family.

## 2. Prepare the agent host

[VERIFIED: `apps/cli/package.json`] The CLI package is private. Build this checkout from the repository root:

```sh
pnpm build --filter=@sokosumi/cli --cache=local:w
node apps/cli/dist/bin/sokosumi.js runtime --help
```

Examples below use `sokosumi` for that executable. Use Node.js 24 and the checkout's dependencies on the agent host.

[VERIFIED: `apps/cli/src/cli/commands/runtime.ts`] The agent needs a command tool and access to its result file. Configure that tool with the built CLI's actual path. The commands below provide the runtime workflow. [REPORTED: integration scope, 2026-09-27] Plugin guidance follows this CLI slice. An MCP-only bridge is not built. No host installation or live agent execution has been verified.

## 3. Configure runtime authentication

[VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`] The developer creates the key with `sokosumi --preprod coworkers api-key COWORKER_ID --api-key-expires-at ISO_EXPIRY --json`. Choose an expiry after the test window. Direct its output into the operator's secure handoff.

[VERIFIED: `apps/cli/src/cli/commands/runtime.ts`; `apps/cli/src/coworker/runtime-credentials.ts`] On the agent host, import that `coworker_*` key through stdin. Set `OPERATOR_SECRET_READER` to your secret reader's executable path:

```sh
"$OPERATOR_SECRET_READER" | sokosumi runtime key-import --coworker-id COWORKER_ID --api-key-stdin --json
```

Import checks `/v1/coworkers/me` before saving the key in a Coworker-scoped OS vault. Keep secrets out of arguments, chat, logs, and plaintext files.

[VERIFIED: `apps/cli/src/coworker/runtime-credentials.ts`; `apps/cli/src/cli/commands/runtime.ts`] On cloud hosts without a vault, an operator wrapper must feed `--api-key-stdin` for each operation. Runtime commands never use developer credentials. [REPORTED: integration scope, 2026-09-27] Secure delivery between machines remains operator work.

## 4. Execute and report once

[VERIFIED: `apps/cli/src/coworker/runtime-task.ts`; `apps/cli/src/cli/commands/runtime.ts`] Run these through the existing agent:

```sh
sokosumi runtime start TASK_ID --coworker-id COWORKER_ID --organization-id ORGANIZATION_ID --json
```

Require `RUNNING`. Execute the returned Task name and description with the agent's current tools. Write the finished answer as UTF-8 text, at most 1 MiB:

```sh
sokosumi runtime complete TASK_ID --coworker-id COWORKER_ID --organization-id ORGANIZATION_ID --result-file ./result.txt --json
```

Require `COMPLETED` and an event ID. On failure, stop. The operator inspects the Task before any retry:

```sh
sokosumi --preprod tasks get TASK_ID --organization-slug WORKSPACE_SLUG --json
sokosumi --preprod tasks events TASK_ID --organization-slug WORKSPACE_SLUG --json
```

[VERIFIED: `apps/core/src/helpers/task-event-charge.ts:46`; `apps/core/src/routes/v1/tasks/[id]/events/post.ts:468`] Core atomically checks the status read inside its request. There is no caller-supplied expected status or worker lease. Use one executor for this Task; a change between the CLI read and Core's POST read can still race.

[REPORTED: user direction, 2026-09-27] Payment work follows CLI and plugin delivery. Task completion does not prove seller receipt.

## Least confident decisions

1. [INFERRED: host requirements above] Each agent host still needs a real installation check. Local fixtures cannot prove its tools or vault work.
2. [REPORTED: seller evidence remains open, 2026-09-27] Seller payload production and wallet receipt need an end-to-end test.
3. [INFERRED: Core `apps/core/src/routes/v1/coworkers/me/usage/post.ts:93`] Separate Workspaces do not establish isolation for every route available to a Coworker key. This pilot needs trusted operators.
