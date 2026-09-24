# ADR 0006: Remote headless Coworker onboarding

- Status: Proposed; needs approval
- Date: 2026-09-24
- Decision source: [REPORTED] User requested link-based human approval for an existing cloud agent.
- Related: ADR 0003, ADR 0004, ADR 0005, SOK-950, SOK-951, SOK-956, SOK-1135, SOK-1184, SOK-1186, SOK-1187, SOK-1194, SOK-1195

## Context

[VERIFIED] The current OAuth flow starts a callback server on `127.0.0.1:53682`, opens the system browser, and waits for the callback on that same machine. It does not return a device login URL to a remote agent. [OAuth code](../../src/auth/oauth.ts#L274) · [Callback server](../../src/auth/oauth.ts#L335) · [Browser login](../../src/auth/oauth.ts#L450)

[VERIFIED] The documented Skill installer adds Skill files. The CLI package has `"private": true`, and the README says npm publication is disabled. A Skill install does not install the CLI binary. [Distribution](../../skills/sokosumi/references/distribution.md#L16) · [Package](../../package.json#L2) · [README](../../README.md#L73)

[VERIFIED] Coworker registration currently checks for an existing workspace but does not send a selected workspace ID. Core labels Coworker creation "admin only" and requires platform admin auth. [CLI registration](../../src/cli/commands/coworkers.ts#L183) · [Core route](../../../core/src/routes/v1/coworkers/post.ts#L20)

[VERIFIED] The CLI target resolver defaults to Mainnet when no target or API URL is supplied. The current `coworkers register` command has no Preprod-only guard. [Target resolver](../../src/auth/config.ts#L178) · [Register command](../../src/cli/commands/coworkers.ts#L183)

[VERIFIED] Core creates Coworkers with `isWhitelisted: false`. Its whitelist route requires platform admin authentication. [Create route](../../../core/src/routes/v1/coworkers/post.ts#L75) · [Whitelist route](../../../core/src/routes/v1/coworkers/[id]/whitelist/patch.ts#L18)

[OPEN] A waitlist submission route or CLI command was not found in the checked Core, Web, or CLI source. The submission surface and API contract remain undetermined. This search does not rule out a manual or differently named process.

[VERIFIED] Human visibility and runtime Task access use separate grants. `CoworkerWorkspaceAccess` controls whether people can select a non-whitelisted Coworker in a workspace. `VendorGrant` controls Task access for a Coworker actor's vendor. [Grant guide](../../../../docs/coworker/vendor-workspace-grants-api.md#L7) · [Database models](../../../../packages/database/prisma/schema.prisma#L404)

[VERIFIED] ADR 0005 separates developer credentials from the runtime `coworker_*` key. Runtime calls cannot use the developer's OAuth token or user API key. [ADR 0005](0005-coworker-runtime-identity-and-invocation-contract.md#L20)

[REPORTED from SOK-909 comment, 2026-09-14] The recorded first runtime target is Nous Research Hermes. The comment describes a shared worker host, a Hermes driver and control plugin, foreground execution, one Coworker binding per Organization workspace, and OS keychain storage for the runtime key. [SOK-909 decision comment](https://linear.app/masumi/issue/SOK-909/deliver-coworker-runtime-integration-and-paid-graduation#comment-4874b4c9)

## Options

1. Keep the current loopback OAuth flow. Run the CLI on the developer's machine, then connect the existing cloud agent with a separate approved handoff.
2. Add a device authorization flow. The cloud agent asks the auth service for a short-lived login code. The owner opens a Sokosumi URL, signs in, selects a workspace, and authorizes the CLI session. This owner action does not approve global listing or change the whitelist.
3. Add a public callback server to the agent host. The owner signs in from a browser, and the callback reaches the cloud agent over public ingress.

## Proposed decision

[PROPOSED] Keep one Developer CLI and one framework-neutral Sokosumi Skill. Let the Skill wrap the plugin CLI through the shared command-dispatch seam. Keep host-specific integration behind an adapter. Use Hermes as the first supported host, as reported in SOK-909. Do not recursively invoke the CLI. [SOK-956](https://linear.app/masumi/issue/SOK-956/publish-agent-agnostic-sokosumi-skill-and-runtime-adapter)

[REPORTED: user decision, 2026-09-24] For the hackathon, Coworker registration runs on Sokosumi Preprod only. On Mainnet, the Coworker Register action shows “Preprod only” and does not submit registration. This restriction applies to Coworker registration, not unrelated CLI commands.

[REPORTED: team discussion pasted by the user, 2026-09-24] The team defers third-party access on Mainnet until “CLI, Skill, Documentation and the platform has a PMF.” Preprod gives developers a place to register and test Coworkers before that launch decision. A Sokosumi platform admin still approves the waitlist request.

[REPORTED: user decision, 2026-09-24] A developer or Coworker submits a waitlist request. A Sokosumi platform admin approves it. The CLI must not change the whitelist command, call the admin-only whitelist route, or enable a Coworker to approve itself. This ADR does not change the permission model or whitelist defaults.

[CORRECTION, REPORTED] An earlier proposal said Core would create or bind a Coworker, grant workspace access, and issue a runtime key after owner approval. That proposal assumed a new self-service permission path. The user rejected permission-model changes for this work. Treat that proposal as withdrawn.

[PROPOSED] Keep the CLI and Skill within existing Sokosumi registration and approval boundaries. The CLI may collect setup details and direct the developer or Coworker to the confirmed waitlist process. Do not invent a Core endpoint or claim that current CLI OAuth grants platform-admin authority.

[OPEN] The current CLI uses a local OAuth callback. A remote headless runtime needs a supported way to authorize the developer and hand off an approved Coworker credential. The waitlist surface and credential-delivery contract are not established by the checked source.

[OPEN] If a supported remote authorization flow is selected, document its code expiry, polling, revocation, and audit behavior in that flow's own contract. This ADR does not approve a Coworker permission change. Keep runtime secrets out of Skill text, model context, argv, logs, and ordinary config.

[PROPOSED] If the owner has no workspace, open the Sokosumi Web workspace screen and resume setup after the owner creates or joins one. Keep workspace creation in Web until Core has an approved CLI route for it.

[PROPOSED] Treat the install command as a Skill installer unless its output confirms that the CLI and the required host adapter are also installed. Publish the CLI and adapter through a documented release path before claiming one-command onboarding.

## Consequences

[INFERRED] This flow needs Core or the OAuth service to support remote device approval. SOK-1135 currently describes a target-scoped developer API key after CLI OAuth. It does not define a device grant or Coworker key handoff.

[VERIFIED] The current CLI target resolver selects Mainnet by default. Enforcing Preprod-only Coworker registration and showing the Mainnet note requires a CLI change. This ADR records the direction; it does not claim that the guard is implemented. [Target resolver](../../src/auth/config.ts#L178) · [Register command](../../src/cli/commands/coworkers.ts#L183)

[VERIFIED] Human workspace visibility uses `CoworkerWorkspaceAccess` or a global whitelist. A Coworker created with `isWhitelisted: false` will not appear in a workspace until that workspace has a `GRANTED` access record. Runtime Task access uses `VendorGrant`. [Access rule](../../../core/src/helpers/access-control.ts#L199) · [Coworker defaults](../../../core/src/routes/v1/coworkers/post.ts#L121) · [Grant guide](../../../../docs/coworker/vendor-workspace-grants-api.md#L7)

[PROPOSED] Keep global listing separate from setup. The new Coworker starts private. The owner tests it in the approved workspace. Global publication stays behind readiness checks and Sokosumi admin review in ADR 0004.

## Least confident decisions

1. [OPEN] Which existing surface accepts a developer or Coworker waitlist request. No matching route or CLI command was found in the checked source.
2. [OPEN] How a remote runtime completes developer authorization and receives its approved `coworker_*` key without changing the existing permission model.
3. [OPEN] Whether the reported Hermes runtime design and OS keychain storage fit the Preprod-only registration flow.
