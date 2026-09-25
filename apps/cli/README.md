# Sokosumi Developer CLI

Private workspace package `@sokosumi/cli`; package path `apps/cli`; binary `sokosumi`. Lives in this monorepo. Product intent is [`VISION.md`](./VISION.md). Contract is [`SPEC.md`](./SPEC.md).

## Planned direction

[REPORTED: user direction, 2026-09-24] The MVP onboards an existing hosted agent as a private Coworker in a selected Preprod Workspace, then proves an MPS payment reaches its Cardano Preprod wallet. Core permission changes are outside this CLI work. Current Core requires a platform admin to create the Coworker record. Global listing requires a separate waitlist request and platform-admin approval. Cardano x402 buyers reach Coworkers through Sokosumi after the MPS-first MVP.

## Hackathon track

[REPORTED: user decision, 2026-09-25] Start with one existing agent per developer on Preprod.

1. A platform admin creates one shared organization Workspace and invites the developers.
2. Each developer creates their own Vendor. The admin provisions one private Coworker under that Vendor and returns its ID.
3. The developer connects that Coworker to the shared Workspace and creates their own `coworker_*` runtime key.
4. Each developer completes a real Task and proves receipt of a Preprod payment.

[OPEN] Payment receipt has not been verified. The detailed [hackathon track](docs/developer-cli-implementation-plan.md#hackathon-track) lists the remaining blockers.

### Organizer setup

[VERIFIED: source only] Web has Workspace creation and developer invitations.
Use the Workspace switcher to create the shared organization, then invite the developers.
See the [creation wizard](../web/src/components/organizations/create-organization-wizard/create-organization-wizard.tsx)
and [invitation form](../web/src/components/organizations/organization-member-invite/form.tsx).

[VERIFIED: CLI fixtures] Sign in to Preprod as a platform admin. Ask each developer for their Vendor ID
and final Coworker name. Check that the Vendor ID belongs to that developer, then run:

```bash
pnpm --filter @sokosumi/cli sokosumi -- --preprod auth login
pnpm --filter @sokosumi/cli sokosumi -- --preprod coworkers provision --vendor-id VENDOR_ID --name "Developer Agent" --capability tasks
```

[VERIFIED: `test/cli/provision.test.ts`] `provision` creates the Coworker record through Core and prints its ID.
It does not require organizer membership in the developer's Vendor or Workspace.
Give the ID to the developer. They use `coworkers connect` and `coworkers api-key` below.
The developer creates and keeps the runtime key.

[VERIFIED: source only, `apps/core/src/routes/v1/coworkers/post.ts:77-80,110-135`]
Core checks platform admin access and Vendor existence, then creates the Coworker with `isWhitelisted: false`.
Provisioning does not grant Workspace access. Private profiles are still returned by Core's
`scope=all` list; private means restricted Workspace selection here.
[List route](../core/src/routes/v1/coworkers/get.ts)
[OPEN] This flow still needs a live Preprod pilot.

The hosted-agent adapter and payment proof are planned work. The registration
and connection commands below are implemented. See [ADR 0004](docs/adr/0004-coworker-capabilities-and-graduation.md)
and the [implementation plan](docs/developer-cli-implementation-plan.md).

Install the framework-neutral Skill from the repository:

```bash
npx skills add https://github.com/masumi-network/sokosumi --skill sokosumi
```

This installs Skill files only. It does not install the CLI executable. The CLI package remains private, so its public release path is still open.

## Run

From the repo root, after `pnpm install`:

```bash
pnpm sokosumi
```

Or:

```bash
pnpm --filter @sokosumi/cli sokosumi
```

That opens the Ink screen. Choose a sign-in method with Up and Down, then press Enter. Use Esc to go back and q to quit. Choose browser OAuth or a user API key, then choose a preset Coworker runtime (pi-sokosumi, Eve, Hermes, OpenClaw). The Ink Register screen remains preset-only. Use the headless commands below to connect the Coworker. OAuth opens Core `/signin`. Stored OAuth credentials and user API keys use the OS vault. Linux persistent auth needs Secret Service. If no vault is available, use `SOKOSUMI_API_KEY` or stdin for the current run.

Headless:

```bash
pnpm --filter @sokosumi/cli sokosumi -- discover --json
pnpm --filter @sokosumi/cli sokosumi -- agents list --json
pnpm --filter @sokosumi/cli sokosumi -- agents hire AGENT_ID --input-json '{"query":"hello"}' --json
pnpm --filter @sokosumi/cli sokosumi -- coworkers list --json
pnpm --filter @sokosumi/cli sokosumi -- tasks list --json
pnpm --filter @sokosumi/cli sokosumi -- jobs list --json
pnpm --filter @sokosumi/cli sokosumi -- jobs input JOB_ID --event-id EVENT_ID --input-json '{"answer":"yes"}' --json
pnpm --filter @sokosumi/cli sokosumi -- auth login --json
printf '%s\\n' "$SOKOSUMI_API_KEY" | pnpm --filter @sokosumi/cli sokosumi -- auth login --api-key-stdin --json
SOKOSUMI_API_KEY=soko_preprod_... pnpm --filter @sokosumi/cli sokosumi -- auth status --json
pnpm --filter @sokosumi/cli sokosumi -- auth logout
```

For hackathon participants, connect the organizer-provisioned Coworker:

```bash
pnpm --filter @sokosumi/cli sokosumi -- --preprod coworkers connect COWORKER_ID --vendor-id VENDOR_ID --workspace-id ORGANIZATION_ID --json
```

Use the organization ID from `workspaces list` as `--workspace-id`. Coworker
`provision`, `register`, and `connect` use Preprod by default when no target is configured.
These commands work on Preprod only. `coworkers register` requires platform admin
access. That command creates the Coworker, then asks Core to grant Workspace
access. It also requires the caller to administer the Vendor and belong to the Workspace.
Use `provision` for the organizer handoff to a developer's Vendor.
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

Target-coded user API keys select mainnet or preprod locally. Legacy keys need `--preprod` or `--api-url`. API keys never go in command arguments.

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
pnpm --filter @sokosumi/cli build
node apps/cli/dist/bin/sokosumi.js --help
```


Local Core (with a registered local OAuth client, if using OAuth):

```bash
pnpm --filter @sokosumi/cli sokosumi -- --api-url http://localhost:8787
```
