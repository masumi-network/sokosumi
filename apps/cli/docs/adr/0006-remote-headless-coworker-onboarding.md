# ADR 0006: Remote headless Coworker onboarding

- Status: Accepted direction; Core and remote-auth contracts remain open
- Date: 2026-09-24
- Decision source: [REPORTED] User requested link-based human approval for an existing cloud agent.
- Related: ADR 0003, ADR 0004, ADR 0005, SOK-950, SOK-951, SOK-956, SOK-1135, SOK-1184, SOK-1186, SOK-1187, SOK-1194, SOK-1195

## Context

[VERIFIED] The current OAuth flow starts a callback server on `127.0.0.1:53682`, opens the system browser, and waits for the callback on that same machine. It does not return a device login URL to a remote agent. [OAuth code](../../src/auth/oauth.ts#L274) · [Callback server](../../src/auth/oauth.ts#L335) · [Browser login](../../src/auth/oauth.ts#L450)

[VERIFIED] The documented Skill installer adds Skill files. The CLI package has `"private": true`, and the README says npm publication is disabled. A Skill install does not install the CLI binary. [Distribution](../../skills/sokosumi/references/distribution.md#L16) · [Package](../../package.json#L2) · [README](../../README.md)

[VERIFIED] CLI registration does not send a selected workspace ID. Core labels Coworker creation "admin only" and requires platform admin auth. [CLI registration](../../src/cli/commands/coworkers.ts#L183) · [Core route](../../../core/src/routes/v1/coworkers/post.ts#L20)

[VERIFIED] The CLI target resolver defaults to Mainnet when no target or API URL is supplied. The current `coworkers register` command has no Preprod-only guard. [Target resolver](../../src/auth/config.ts#L178) · [Register command](../../src/cli/commands/coworkers.ts#L183)

[VERIFIED: source only] The create handler sets `isWhitelisted: false`, and the whitelist route requires platform admin authentication. This does not verify a Preprod deployment default. [Create route](../../../core/src/routes/v1/coworkers/post.ts#L75) · [Whitelist route](../../../core/src/routes/v1/coworkers/[id]/whitelist/patch.ts#L18)

[VERIFIED] Vendor admins can manage an existing Coworker, grant it access to a workspace where they are a member, and create a Coworker API key. These routes do not create the Coworker record. [Management access](../../../core/src/routes/v1/coworkers/coworker-management-access.ts#L26) · [Workspace grant](../../../core/src/routes/v1/coworkers/[id]/workspace-access/post.ts#L52) · [API key create](../../../core/src/routes/v1/coworkers/[id]/api-keys/post.ts#L48)

[OPEN] A waitlist submission route or CLI command was not found in the checked Core, Web, or CLI source. The submission surface and API contract remain undetermined. This search does not rule out a manual or differently named process.

[VERIFIED] Human visibility and runtime Task access use separate grants. `CoworkerWorkspaceAccess` controls whether people can select a non-whitelisted Coworker in a workspace. `VendorGrant` controls Task access for a Coworker actor's vendor. [Grant guide](../../../../docs/coworker/vendor-workspace-grants-api.md#L7) · [Database models](../../../../packages/database/prisma/schema.prisma#L404)

[VERIFIED] ADR 0005 separates developer credentials from the runtime `coworker_*` key. Runtime calls cannot use the developer's OAuth token or user API key. [ADR 0005](0005-coworker-runtime-identity-and-invocation-contract.md#L20)

[REPORTED from SOK-909 comment, 2026-09-14] The recorded first runtime target is Nous Research Hermes. The comment describes a shared worker host, a Hermes driver and control plugin, foreground execution, one Coworker binding per Organization workspace, and OS keychain storage for the runtime key. [SOK-909 decision comment](https://linear.app/masumi/issue/SOK-909/deliver-coworker-runtime-integration-and-paid-graduation#comment-4874b4c9)

## Options

1. Keep the current loopback OAuth flow. Run the CLI on the developer's machine, then connect the existing cloud agent with a separate approved handoff.
2. Add a device authorization flow. The cloud agent asks the auth service for a short-lived login code. The owner opens a Sokosumi URL, signs in, selects a workspace, and authorizes the CLI session. This owner action does not approve global listing or change the whitelist.
3. Add a public callback server to the agent host. The owner signs in from a browser, and the callback reaches the cloud agent over public ingress.

## Decision and open contracts

[PROPOSED] Keep one Developer CLI and one framework-neutral Sokosumi Skill. Let the Skill wrap the plugin CLI through the shared command-dispatch seam. Keep host-specific integration behind an adapter. Use Hermes as the first supported host, as reported in SOK-909. Do not recursively invoke the CLI. [SOK-956](https://linear.app/masumi/issue/SOK-956/publish-agent-agnostic-sokosumi-skill-and-runtime-adapter)

[REPORTED: user decision, 2026-09-24] For the hackathon, Coworker registration runs on Sokosumi Preprod only. On Mainnet, the Coworker Register action shows “Preprod only” and does not submit registration. This restriction applies to Coworker registration, not unrelated CLI commands.

[REPORTED: team discussion pasted by the user, 2026-09-24] The team defers third-party access on Mainnet until “CLI, Skill, Documentation and the platform has a PMF.” Preprod gives developers a place to register and test Coworkers before that launch decision. A Sokosumi platform admin still approves the waitlist request.

[REPORTED: user clarification, 2026-09-24] This CLI work leaves Core permissions unchanged. Do not change the whitelist command, call the admin-only whitelist route, or let a Coworker approve itself. A platform admin must create the Coworker record under current Core rules. A Vendor admin can then use the existing management, workspace-access, and key routes. The platform admin remains responsible for global listing approval.

[CORRECTION, REPORTED: user clarification, 2026-09-24] An earlier amendment proposed allowing Vendor admins to create Coworker records on Preprod. User clarified that permissions stay unchanged and work outside the CLI is owned by the team. Withdraw the proposed Core permission change. If the team keeps current permissions, a platform admin must provision the Coworker before the CLI can finish workspace setup.

[PROPOSED] Keep the CLI and Skill within existing Sokosumi authorization boundaries. The CLI may create a Coworker only when the signed-in user has the required existing Core role. A Vendor admin can use current CLI commands to manage a platform-admin-provisioned Coworker and create its runtime key. Workspace-grant support remains CLI work. Do not invent a Core endpoint or claim that developer OAuth grants platform-admin authority.

[REPORTED: user decision, 2026-09-24] Coworker registration is Preprod-only for this developer flow. The CLI shows “Preprod only” on Mainnet and sends no registration request. Other CLI commands remain network-configurable.

[REPORTED: user decision, 2026-09-24] Registration selects an existing Workspace. The Coworker stays private and is available only in a Workspace with a `GRANTED` access record. The CLI does not change Core permission checks to create that record.

[OPEN] The current CLI uses a local OAuth callback. A remote headless runtime needs a supported way to authorize the developer and hand off an approved Coworker credential. The waitlist surface and credential-delivery contract are not established by the checked source.

[OPEN] If a supported remote authorization flow is selected, document its code expiry, polling, revocation, and audit behavior in that flow's own contract. This ADR does not approve a Coworker permission change. Keep runtime secrets out of Skill text, model context, argv, logs, and ordinary config.

[PROPOSED] If the owner has no workspace, open the Sokosumi Web workspace screen and resume setup after the owner creates or joins one. Keep workspace creation in Web until Core has an approved CLI route for it.

[VERIFIED] `npx skills add https://github.com/masumi-network/sokosumi --skill sokosumi` installs the Skill files from the repository. It does not install the CLI executable. The CLI package is private and its public install path is open. [Skill distribution](../../skills/sokosumi/references/distribution.md#L1) · [Package](../../package.json#L2)

[OPEN] A remote cloud runtime needs an owner approval URL and a safe runtime-key handoff. The current OAuth flow uses a callback on the same machine. This ADR does not define a device grant or credential-delivery endpoint.

## Consequences

[INFERRED] This flow needs Core or the OAuth service to support remote device approval. SOK-1135 currently describes a target-scoped developer API key after CLI OAuth. It does not define a device grant or Coworker key handoff.

[VERIFIED] The current CLI target resolver selects Mainnet by default. Enforcing Preprod-only Coworker registration and showing the Mainnet note requires a CLI change. This ADR records the direction; it does not claim that the guard is implemented. [Target resolver](../../src/auth/config.ts#L178) · [Register command](../../src/cli/commands/coworkers.ts#L183)

[VERIFIED] Human workspace visibility uses `CoworkerWorkspaceAccess` or a global whitelist. A Coworker created with `isWhitelisted: false` will not appear in a workspace until that workspace has a `GRANTED` access record. Runtime Task access uses `VendorGrant`. [Access rule](../../../core/src/helpers/access-control.ts#L199) · [Coworker defaults](../../../core/src/routes/v1/coworkers/post.ts#L121) · [Grant guide](../../../../docs/coworker/vendor-workspace-grants-api.md#L7)

[PROPOSED] Keep global listing separate from setup. The new Coworker starts private. The owner tests it in the approved workspace. Global publication stays behind readiness checks and Sokosumi admin review in ADR 0004.

## Least confident decisions

1. [OPEN] Whether platform-admin pre-provisioning is the intended first release path for Coworker records. Current Core create authorization does not allow an ordinary Vendor admin to create one.
2. [OPEN] How a remote runtime receives an owner approval URL and a `coworker_*` key. The current OAuth flow only supports a same-machine callback.
3. [OPEN] Which surface accepts a waitlist request. No matching route or CLI command was found in the checked source.
