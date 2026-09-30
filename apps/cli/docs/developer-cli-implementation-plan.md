# Developer CLI implementation plan

[CORRECTION, VERIFIED: merged source `c2271e441`, 2026-09-30] MPS-first MVP plan. Receipt reading is merged. Paid runtime implementation and live payment proof remain open.

## Current product direction

[CORRECTION, REPORTED: user product direction, 2026-09-27] The earlier plan centered the hackathon developer flow. The CLI and Skill are a continuing, framework-neutral product. Private Workspace setup with an existing agent comes first. Developer onboarding and global listing follow that path. The hackathon is the first milestone. Discover and reuse existing Workspaces, Vendors, and Coworkers before proposing creation. Hermes is optional; the shared runtime commands remain the common interface. Hosts can use the operator's hardware or cloud environment.

[VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`, `apps/cli/src/cli/registration-authority.ts`] Current Core creation still requires platform admin. Current CLI connection requires Vendor-admin membership and membership in the selected organization, even for platform admins. Organization owner/admin status alone does not grant either permission. The CLI does not connect a personal Workspace through this path. These product instructions do not change Core permissions or billing.

[VERIFIED: `apps/cli/src/cli/commands/runtime.ts:258`, `apps/cli/src/coworker/runtime-task.ts:195`, at `c2271e441`] The shared execution path uses `runtime key-import`, `runtime start`, and `runtime complete`. `runtime receipt` reads an existing Task payment through Core. Completion submits status and result text without `masumiPayment`. [OPEN] Live execution and intended seller wallet receipt remain unproven. Follow the [current Skill](../skills/sokosumi/SKILL.md) for setup.

## Payment delivery status, 2026-09-30

[VERIFIED: git history at `c2271e441`] [#5342](https://github.com/masumi-network/sokosumi/pull/5342) merged the Core receipt route and CLI reader. [VERIFIED: `apps/core/src/helpers/coworker-task-receipt.ts:113-122`] The reader reports MPS settlement state after checking stored purchase terms. A settled result can have a null transaction hash. This source behavior does not prove a live Coworker payment.

[VERIFIED: draft branch contents, 2026-09-30] These open draft PRs contain planning documents and corrections to existing guides. Each draft uses the preceding branch, with #5463 based on `main`.

| Draft | Proposed implementation | Brief |
| --- | --- | --- |
| [#5463](https://github.com/masumi-network/sokosumi/pull/5463) | Seller binding and customer Task approval | [Seller authorization](mps-payment-stack/01-seller-authorization.md) |
| [#5464](https://github.com/masumi-network/sokosumi/pull/5464) | Funding, execution, result submission, collection and recovery | [Paid runtime](mps-payment-stack/02-paid-runtime.md) |
| [#5465](https://github.com/masumi-network/sokosumi/pull/5465) | CLI and Skill flow, payment display and live proof | [Plugin flow](mps-payment-stack/03-plugin-flow.md) |

[CORRECTION, REPORTED: user decisions, 2026-09-30] The first flow will use an existing developer-managed MPS seller. Self-service CLI setup will store its scoped credential encrypted in Core. The Task billing owner will approve each fixed quote. Organization approval will require membership and applicable Seat eligibility in the original billing organization. Implementation is pending. Live end-to-end acceptance must tie the delivered Task to the intended seller's payment.

[CORRECTION, VERIFIED: `apps/cli/package.json:2-18,30-31`, at `c2271e441`] The source manifest declares `@masumi_network/sokosumi` version `1.0.2`, public access, Node.js 24, and `dist` plus `skills`. Earlier private-package and undecided-package statements are stale. [OPEN] This review did not check npm's current release or perform a fresh registry installation.

## Feature PR delivery, 2026-09-27

[CORRECTION, VERIFIED: git history at `c2271e441`, 2026-09-30] All eight PRs below are merged. The earlier draft-stack description recorded their initial delivery state. The dated test and pilot records remain historical evidence.

| Order | Slice | Review |
| --- | --- | --- |
| 1 | Preprod registration and selected Workspace access | [#5241](https://github.com/masumi-network/sokosumi/pull/5241) |
| 2 | Live account identity with `auth whoami` | [#5282](https://github.com/masumi-network/sokosumi/pull/5282) |
| 3 | Platform-admin provisioning checks and handoff | [#5283](https://github.com/masumi-network/sokosumi/pull/5283) |
| 4 | Existing member onboarding and available Seat assignment | [#5284](https://github.com/masumi-network/sokosumi/pull/5284) |
| 5 | Organization selection for Task commands | [#5285](https://github.com/masumi-network/sokosumi/pull/5285) |
| 6 | Generic Coworker runtime identity and Task operations | [#5286](https://github.com/masumi-network/sokosumi/pull/5286) |
| 7 | Optional execution through an existing Hermes profile | [#5287](https://github.com/masumi-network/sokosumi/pull/5287) |
| 8 | Framework-neutral plugin and private Workspace guidance | [#5288](https://github.com/masumi-network/sokosumi/pull/5288) |

[CORRECTION, VERIFIED: local command output, 2026-09-27] The earlier stack reported 422 passing tests. After syncing with `main` at `e091b937b289df5074b9925c9b04f89e56dcc7f2` and adding 18 recovery tests, the Node `v24.19.0` suite reports `tests 440`, `pass 440`, `fail 0`, and `skipped 0`. The CLI build passed. Base recovery commit hooks report `17 successful, 17 total` typecheck tasks. Subprocess fixtures do not prove a live Hermes provider or a Preprod Task. Earlier shell checks used Node `v26.8.1`; these checks explicitly selected Node 24.

[REPORTED: independent Fresh Eyes review, 2026-09-27] The reviewer found one recovery gap: a failed creation response could hide a successful Coworker creation. [VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`, `apps/cli/test/cli/coworker-creation-recovery.test.ts`] Uncertain failures now direct inspection before retrying and retain Core error fields. Name validation runs before creation. [REPORTED: final review] Fresh Eyes found no remaining issue in the integrated fix. Live authentication, provider execution, and seller receipt remain outside this review.

[VERIFIED: regression output] Before the runtime fixes, delayed stdin and malformed event tests reported `tests 3`, `pass 0`, `fail 3`. Focused checks after the fix reported `tests 9`, `pass 9`, `fail 0`. A source-only mutation that restored unrestricted Hermes environment inheritance failed the retained filtering test: `tests 1`, `pass 0`, `fail 1`.

[VERIFIED: Skills CLI `1.7.0`, local checkout] Temporary project installs for Claude Code and Hermes Agent returned `status: installed`, `scope: project`, and `mode: copy`. Both installed files matched source bytes. Repository discovery needs `--full-depth`; without it, this installer missed all six CLI Skills. This check did not run a host model or fetch GitHub.

[REPORTED: pilot scope, 2026-09-27] Live runtime execution, host installation, Seat readiness for the pilot user, and payment receipt were open at that checkpoint. User-managed subscriptions remain in Web. [CORRECTION, VERIFIED: git history at `c2271e441`] The setup stack has merged. The payment drafts above define the next planned work. [OPEN] Current pilot Seat capacity has not been rechecked.

## Goal and scope

[REPORTED: user decision, 2026-09-24] Use the CLI and its Skill to onboard an existing hosted agent as a private Coworker in one selected Sokosumi Workspace. Hermes is the first runtime. The MVP uses MPS through Sokosumi Tasks and must prove payment receipt in the Coworker's Cardano Preprod wallet.

[REPORTED: user decision] Keep the Coworker private until it works in the selected Workspace and meets payment requirements. Global listing requires a separate waitlist request and platform-admin approval. Cardano x402 buyers reach Coworkers through Sokosumi after the MPS-first MVP.

The contract is [SPEC.md](../SPEC.md). The architecture decision is [ADR 0004](adr/0004-coworker-capabilities-and-graduation.md). Follow those documents before implementing a slice. Use the existing TypeScript CLI and Core HTTP boundary. Skills CLI installs the Skill files only. [CORRECTION, VERIFIED: `apps/cli/package.json:13-25`] The source defines public npm packaging and a local CLI build. [OPEN] A fresh registry installation has not been verified in this review.

## Hackathon track

[REPORTED: user decision, 2026-09-25] Use one shared organization Workspace on Preprod. Start with one existing agent per developer and one private Coworker record for that agent. Keep implementation changes under `apps/cli`; use existing Core permissions and routes. The success check is a real Task completed by each developer's Coworker, followed by proof that the intended developer received the Preprod payment.

[CORRECTION, VERIFIED: `apps/cli/src/cli/registration-authority.ts:53-71`, `CONTEXT.md:250-254`, 2026-09-27] The earlier shared-Workspace decision describes the pilot arrangement. The CLI does not require all developers to share one Workspace. Select an organization from the caller's memberships. Organization credits form a shared pool; a Seat is not a separate spending allowance. Separate developer Workspaces can provide separate organization access and credit pools. This CLI work changes no Core authorization or billing policy.

1. [REPORTED: user decision] A platform admin selects the organization Workspace and invites the intended developers. [VERIFIED: `CONTEXT.md:250`] On a paid Organization, its owner or admin must assign a Seat before a member can use Tasks. Check the actual Preprod plan and Seat capacity before the event; they have not been verified.
2. [VERIFIED: `apps/core/src/routes/v1/vendors/post.ts:23-25,87-104`] Each developer can create their own Vendor and becomes its admin. The developer gives the organizer the Vendor ID and final Coworker name. [VERIFIED: `apps/core/src/routes/v1/coworkers/post.ts:82-113`] Creation derives a unique slug from the name. Check name availability before provisioning.
3. [VERIFIED: `apps/core/src/routes/v1/coworkers/post.ts:77-80,110-135`] A platform admin creates the Coworker under that Vendor. Core checks that the Vendor exists, but the organizer must verify that the Vendor ID belongs to the intended developer. Core creates the Coworker with `isWhitelisted: false`. The organizer returns the Coworker ID only. The ID identifies a record; the `coworker_*` key grants runtime access and stays with the developer.
4. [VERIFIED: `apps/cli/src/cli/commands/coworkers.ts:250-315`; `apps/core/src/helpers/coworker-workspace-access.ts:458-481`] The developer runs the CLI on their laptop. They connect the Coworker to the selected Workspace and create its key. A Vendor admin who belongs to that Workspace gets `GRANTED` access through the current Core route. Different Vendors can connect Coworkers to the same Workspace. A `GRANTED` record makes a private Coworker selectable by Workspace members.
5. [REPORTED: user decision] Each developer runs their agent against a real Task and proves Preprod payment receipt. [VERIFIED: `apps/core/src/routes/v1/tasks/[id]/events/post.ts:319-328,419-460`; `apps/core/src/services/task-payment-claim.service.ts:146`] The assigned Coworker can submit `masumiPayment` on a Task event. `TaskPaymentClaim.PURCHASED` alone does not prove that the seller received funds. Collect the actual seller receipt for each developer.

[OPEN] The hosted-agent adapter, MPS seller identity and wallet setup, safe runtime-key delivery, CLI executable distribution, Preprod credits, and Seat capacity need an event test. The CLI has no `masumiPayment` command yet.

[CORRECTION, VERIFIED: CLI fixtures] The earlier track left admin provisioning as a direct Core operation. `coworkers provision --vendor-id VENDOR_ID --name NAME --capability tasks` now calls that route from the CLI. It returns the Coworker ID for the developer to connect and create a key. Core still requires platform admin access. The organizer does not need membership in the developer's Vendor. Workspace creation and invitations use the existing Web flow. The current `coworkers register` command still requires Vendor admin and Workspace membership. [Provisioning tests](../test/cli/provision.test.ts) · [Setup steps](../README.md#private-workspace-setup-and-platform-admin-handoff)

[OPEN] Choose Task visibility after a pilot. A Workspace grant lets members select the Coworker; it does not make every private Task visible to it. A Coworker can see public Tasks and private Tasks assigned to itself or a same-Vendor Coworker. [Task visibility](../../core/src/helpers/task-visibility.ts#L132-L170)

## Architecture and ownership

[REPORTED: approved boundaries] One developer CLI lives in `apps/cli`. Skills teach supported runtimes how to use the integration. Thin adapters handle framework-specific execution. They do not duplicate Core's authorization or Masumi's settlement logic.

| Component | Owns | Must not own |
| --- | --- | --- |
| Developer CLI | Human login, Preprod setup, existing Core-authorized Coworker management, Workspace access request, diagnostics | Permission bypass, self-approval, wallet signing backend |
| Skill at `apps/cli/skills/sokosumi` | Discoverable setup and use instructions for supported runtimes | Core authorization, broad developer credentials, a second CLI product |
| Runtime adapter and worker | Coworker execution identity, task invocation, progress, reconnect behavior | Granting itself workspace access or replacing Core task authority |
| Core | Existing Coworker authorization, Workspace grants, Task/Job state, spending authorization, waitlist review | CLI permission changes or treating runtime-reported credits as seller receipt |
| Masumi Payment Service | MPS payment execution and settlement | Sokosumi Workspace authorization or administrative promotion |

[VERIFIED: ADR 0005, 2026-09-21] Shared command handlers serve integrations directly. Do not recursively launch the CLI entrypoint from the TUI or adapters. Developer auth (OAuth / user API key) remains separate from runtime auth (`coworker_*` only). A short-lived developer-delegation token is rejected for the current path.

[VERIFIED] Current Core Coworker creation requires platform admin authentication. This CLI work does not change that permission. Vendor admins can manage an existing Coworker, grant Workspace access, and create a runtime key. If ordinary developers must create Coworkers themselves, the Sokosumi team must define that server-side path. [Create route](../../core/src/routes/v1/coworkers/post.ts#L77-L80) · [Management access](../../core/src/routes/v1/coworkers/coworker-management-access.ts#L24-L66) · [Workspace access](../../core/src/routes/v1/coworkers/[id]/workspace-access/post.ts#L48-L74)

[VERIFIED] The current CLI lists organization workspaces but does not create one. When none exists, it directs the user to the Sokosumi Web workspace switcher. [Workspace guidance](../src/cli/registration-authority.ts#L18-L23) · [Workspace command](../src/cli/commands/workspaces.ts#L39-L45)

[VERIFIED: CLI source] `coworkers register` creates a Coworker through Core, then requests Workspace access. `coworkers connect` requests access for an existing Coworker. Both report completion only after `GRANTED`. [CORRECTION, REPORTED: pilot run, 2026-09-27] The recorded pilot reached `GRANTED`; current live access has not been rechecked. [CLI command](../src/cli/commands/coworkers.ts) · [Core route](../../core/src/routes/v1/coworkers/[id]/workspace-access/post.ts)

The runtime initiates its local connection outward. Automatic work requires a running worker; a closed local session is not an always-on service. Cloud-hosted operation needs the same capability checks and credential isolation. Verify the exact Hermes, OpenClaw, Pi, Eve, Claude Code, or other framework interface before claiming support. A tool-call integration does not prove automatic execution support.

[VERIFIED: inspected API snapshot] The referenced Masumi CLI's `src/generated/payment/types.d.ts:5217-5254` describes Cardano x402 unsigned transaction construction; `:9755-9824` describes managed EVM signing and a payment header returned to the caller. These are distinct implementation paths, not live deployment verification. The Masumi CLI repository remains read-only reference material.

[PROPOSED] Preserve that split behind the user-facing payment capability. Resolve network, asset, recipient, approved amount, and selected funding source before payment. A payment header or customer debit is not seller receipt. General x402 resource access also requires destination and redirect controls. No new payment command or Masumi SaaS contract is implied by this document.

## ASCII flows

[PROPOSED] These diagrams describe the agreed direction, not installed commands or implemented transports. A framework runtime acts as a Coworker; a Masumi Agent is a separate service it can hire.

### CLI setup and runtime operation

```
Developer
  |
  | Install the Sokosumi Skill from apps/cli/skills/sokosumi
  | Skills CLI installs Skill files only
  v
Existing hosted agent
  |
  | Needs the Sokosumi CLI executable
  | Source build documented; current npm installation unverified
  v
Sokosumi CLI
  |
  | Owner browser approval URL for remote auth
  | Auth-service contract: OPEN; current flow uses same-machine callback
  v
Sokosumi Preprod
  |
  +-- Create Coworker: current Core role is platform admin
  |     isWhitelisted starts false
  |
  +-- Ordinary Vendor admin: existing Core create route rejects request
  |     Platform-admin provisioning is required under current permissions
  |
  v
Vendor admin selects an existing Workspace
  |
  | Existing workspace-access route returns GRANTED
  v
Private Coworker in selected Workspace
  |
  | Hermes adapter uses Coworker runtime identity
  v
Sokosumi Tasks and other existing Workspace capabilities

Mainnet Coworker registration: show "Preprod only" and send no request.
Other CLI commands remain network-configurable.
```

The CLI administers the connection. Runtime credentials and execution belong to the adapter, not the developer login. The CLI cannot create Core permissions. A brief session does not require an always-on worker.

### Road to paid graduation

```
Private Coworker in selected Workspace
  |
  | Complete MPS-first Sokosumi Task payment test
  v
Seller receipt in Coworker's Cardano Preprod wallet
  |
  | Submit waitlist request through a confirmed surface
  | Request surface: OPEN
  v
Sokosumi platform admin review
  |
  +-- Changes requested --> fix evidence, then resubmit
  |
  +-- Explicit approval --> global listing
  |
  +-- No approval --> Coworker stays private

Global approval remains separate from Workspace access and whitelist control.
Chat, external buying, and broader readiness checks are later capabilities.
```

The diagram shows later global graduation, not the initial CLI MVP. The MPS payment route and wallet receipt require Preprod proof before the waitlist step.

The sections below describe later capability work. The MVP only needs one authorized Sokosumi Task path to test MPS payment. Broader chat, Task/Job automation, and x402 buying remain separate slices.

### Spending versus earning

```
Coworker sells a Sokosumi Task
  |
  v
Sokosumi Core creates Task payment claim
  |
  | Current code charges Task credits, then creates MPS purchase
  v
Masumi Payment Service
  |
  v
Cardano escrow lifecycle
  |
  v
Coworker wallet receipt: OPEN, must prove on Preprod

Later external x402 buyer
  |
  v
Sokosumi Coworker route
  |
  v
MPS / Cardano SDK compatibility test: OPEN
```

Customer charging and seller receipt are separate outcomes. `TaskPaymentClaim.PURCHASED` is not seller receipt proof. External x402 and SDK compatibility are out of the MVP.

## Evidence from the target base

[VERIFIED: source inspection at 63377d7; not runtime verification]

| Source | Observed behavior | Consequence |
| --- | --- | --- |
| `apps/core/src/routes/v1/coworkers/post.ts:75-132` | Admin-only registration; requires Vendor; creates an unwhitelisted Coworker | Self-service registration needs an approved Core contract |
| `apps/cli/src/auth/config.ts:43-46` | Developer CLI rejects Coworker keys | Do not remove the guard to make a plugin work |
| `apps/core/src/helpers/access-control.ts:199-265` | Human availability and Coworker actor access are separate checks | Workspace-only listing is not a credential restriction |
| `apps/core/src/routes/v1/coworkers/me/events/get.ts:68-94` | Pulls events for assigned non-DRAFT Tasks | Reuse as an input source, not as a work-claim protocol |
| `apps/core/src/routes/v1/coworkers/me/usage/post.ts:91-200` | Coworker reports credits and customer identity; Core records an idempotent debit | Metering does not establish a customer-approved price or seller receipt |
| `apps/core/src/services/task-x402-payment.service.ts:238-310` | Requires listed payable Agent; validates demands; dynamic pricing requires a ceiling | General external x402 purchases need additional Core policy |

## Stages and checkpoints

[PROPOSED] Stages describe progress within a chosen capability, not a compulsory product ladder: selected, configured, verified, then eligible where applicable. A failed or stale check returns that capability to action-required. Public approval is a separate Core decision.

| Checkpoint | Prerequisite and owner | Pass evidence | Failure or revalidation condition |
| --- | --- | --- | --- |
| C0: Workspace and ownership | Developer login; Core authorizes workspace and Vendor | Authorized setup succeeds; foreign ownership is denied | Ownership or workspace grant changes |
| C1: Runtime connection | C0 and approved runtime auth contract; Core plus adapter | Correct actor identity; bounded session expiry; disconnect/reconnect proof; no developer-auth fallback | Credential expiry, revocation, or changed adapter configuration |
| C2: Chat participation | C1, approved transport, authorized room; Core plus adapter | Mention and reply in direct chat, channel, and group for each supported type; unrelated context denied | Membership revocation, transport change, or stale delivery evidence |
| C3: Tasks and Jobs | C1 and required grants; Core plus adapter | Authorized reads, updates, follow-up Task, and Task-linked Agent Job; unauthorized transitions denied; duplicate delivery safe | Grant or execution contract changes; failed recovery test |
| C4: x402 purchasing | C1, funding selection, Masumi configuration; Core and payment service | Controlled purchase for each advertised rail/funding mode; invalid amount, asset, recipient, and network rejected; retry reconciled | Budget, wallet, rail, or signer configuration changes |
| C5: Seller readiness | Seller registration and accepted test pricing; Core and payment service | Metering tied to authorized work; customer debit, delivered result, and intended seller receipt; duplicate billing denied | Price, receiving wallet, settlement integration, or relevant test validity changes |
| C6: Paid eligibility | C0/C1, public isolation proof, C5, and only advertised capability checks; Core | Current live policy plus valid non-derivable evidence passes the declared service profile | Any required authority or evidence becomes invalid; unknown readiness fails closed |
| C7: Public approval | C6 and developer application with pricing; Sokosumi administration | Explicit recorded approval after review; customer workspace still authorizes use | Required readiness loss blocks affected service; approval history remains; new public pricing needs review |

[PROPOSED] Checkpoint output identifies the capability, current result, missing prerequisite, evidence reference, configuration version, and next action. Core derives live grants and health rather than copying them into attestations. Persist test results only when the live authoritative state cannot establish the claim.

A private-session profile can stop at C1 or add C2/C3. A buyer-only profile can add C4 without C5 or public graduation. A public Task service needs C3 and seller readiness, but not chat or arbitrary outbound buying unless offered. A developer may register solely to run the applicable checks.

[DECISION] A checkpoint is not a claim that its implementation or test suite exists. Each delivery unit below must add its behavioral checks and record the actual execution result. Publishing the documentation does not pass any runtime or financial checkpoint.

## Delivery units

These units describe independently reviewable outcomes, not a forced user journey. Each implementation PR must first resolve its contract prerequisites, specify exact changed files and runnable checks, and include both allowed and denied scenarios. This direction document is not permission to invent unresolved APIs.

### Priority order for small PRs

[REPORTED: user decision, 2026-09-20] Each PR is a small vertical slice. One issue may produce several bounded PRs. Reuse SOK-956; do not open a duplicate. No CLI PR changes Core permissions, whitelist defaults, or MPS behavior. Team-owned dependencies stay explicit below.

1. [DONE] CLI-only read-only discovery. `vendors me` and `workspaces list` use existing Core routes. Vendor roles and organization identities remain explicit. This slice made no Core edits or Coworker registrations.
   - Files: `apps/cli/SPEC.md`, `apps/cli/docs/developer-cli-implementation-plan.md`, `apps/cli/src/api/models/organization-workspace.ts`, `apps/cli/src/api/models/vendor.ts`, `apps/cli/src/api/services/organization-workspace-service.ts`, `apps/cli/src/api/services/vendor-service.ts`, `apps/cli/src/cli/commands/discover.ts`, `apps/cli/src/cli/commands/vendors.ts`, `apps/cli/src/cli/commands/workspaces.ts`, `apps/cli/src/cli/index.ts`, `apps/cli/test/api/vendor-workspace-service.test.ts`, `apps/cli/test/cli/bin.test.ts`, `apps/cli/test/cli/commands/vendors-workspaces.test.ts`, `apps/cli/test/cli/index.test.ts`.
   - Checks: `pnpm --filter ./apps/cli test`; `pnpm --filter ./apps/cli typecheck`; `pnpm --filter ./apps/cli build`; `pnpm --filter core test src/routes/v1/vendors/get.test.ts src/routes/v1/vendors/vendor-admin.test.ts src/routes/v1/users/user-path-access.test.ts src/routes/v1/users/user-route-context.test.ts`; `pnpm exec biome check apps/cli/src apps/cli/test`; remove and restore V79/V80 guards, then rerun `pnpm --filter ./apps/cli test` to prove red and green.
   - Allowed: authenticated exact commands, Vendor memberships with roles, organization-workspace candidates, text output, one-document JSON. Denied: unauthenticated Core calls, bare/wrong subcommands, malformed lists, missing IDs, organization metadata output, Vendor creation, registration, and TUI changes.
1b. [DONE 2026-09-21 / SOK-966 PR2] Controlled registration selection. Headless `coworkers register` requires at least one organization workspace and an administered (`admin`) Vendor. Foreign/non-admin Vendor ids fail before Core create. Gate copy directs blocked developers to `sokosumi vendors create`; Coworker create remains platform-admin only. Signed-in TUI has no Register screen; create stays headless until T41.
1c. [DONE / PR developer Vendor create] Developer self-service Vendor create uses Core `POST /v1/vendors`; the caller becomes admin. This does not create a Coworker.
2. [DONE 2026-09-21 / SOK-967 / ADR 0005] Runtime identity uses `coworker_*`. Keep it separate from developer auth and preserve developer-key guards.
3. [BLOCKING TEAM DEPENDENCY] Current Core requires platform admin to create a Coworker. With permissions unchanged, a platform admin must provision the record before a Vendor admin can finish onboarding. The CLI must not bypass this role check. If the team expects ordinary developers to create records, the Core team must define that API separately.
   [REPORTED: user decision, 2026-09-25] For the hackathon, this is an organizer task for each developer. Follow the [hackathon track](#hackathon-track). This flow does not provide instant self-service registration.
4. [IMPLEMENTED IN CLI SOURCE; LIVE PREPROD NOT CHECKED] Enforce Preprod-only Coworker registration in CLI. On Mainnet, show “Preprod only” and send no registration request. Keep other CLI commands network-configurable.
5. [IMPLEMENTED IN CLI SOURCE; LIVE PREPROD NOT CHECKED] Select an existing Coworker, administered Vendor, and Workspace. Use the existing Core workspace-access route. Report registration complete only after `GRANTED`. The CLI directs users to Web to create or join a Workspace.
6. [CLI MVP] Connect Hermes through a framework-neutral adapter and prove one authorized Sokosumi Task operation.
7. [MPS MVP] Trace the existing Task/MPS path on Cardano Preprod, then prove seller receipt in the configured Coworker wallet. Do not equate Task credit debit or `TaskPaymentClaim.PURCHASED` with receipt.
8. [LATER] Add waitlist request and platform-admin review after the current submission surface is confirmed.
9. [LATER] Route Cardano x402 buyers through Sokosumi after MPS seller receipt works. Prove MPS/SDK compatibility before implementation.
10. [CORRECTION, VERIFIED: `apps/cli/package.json:13-25`] Public package configuration and the local binary build exist. [OPEN] Verify the released artifact and fresh installation before promising one-command onboarding.

Remote owner approval URL is another MVP dependency. The current OAuth flow uses a same-machine loopback callback. The Auth/Core team must define the remote flow; the CLI must not expose a developer token to the agent runtime.

### A. Private registration and connection

[PROPOSED] Onboard one existing hosted runtime as a Coworker in one authorized Workspace. Hermes is the first runtime. Keep Core permissions unchanged in the CLI work.

Owners: CLI controls setup; Core owns existing Vendor authorization, Coworker records, Workspace grants, expiry, and revocation; the runtime adapter owns its connection.

Prerequisites: a Coworker record exists under a Vendor the developer administers. Current Core requires platform admin for Coworker creation. With permissions unchanged, a platform admin must provision the record. Runtime identity contract is approved ([ADR 0005](adr/0005-coworker-runtime-identity-and-invocation-contract.md)). The developer selects an existing Workspace. The current CLI sends users to Sokosumi Web to create or join a Workspace when none exists.

Acceptance cases:
- The CLI refuses Coworker registration on Mainnet and sends no request. Other commands retain their selected network.
- The CLI attaches an existing Coworker to the selected Workspace through the existing API and reports success only after `GRANTED`.
- Coworker creation respects existing Core roles. The CLI does not grant itself platform-admin authority.
- Runtime API calls access only their permitted workspace and never fall back to developer authentication. Trusted private sessions do not promise host-level credential isolation.
- Session expiry and explicit disconnect revoke temporary authority; a crash cannot leave permanent session authority.
- Inactive identity and work history remain after expiry. No shared Task, Job, or message is deleted.
- Reconnection requires authorization. Persistent mode is explicit, not an accidental result of storing a session token.

### B. Active-session operations and automatic execution

[PROPOSED] Support both runtime-operated tools during a live session and a connected worker for automatic assignment.

[VERIFIED: ADR 0005, 2026-09-21] Use shared operation handlers; never recursive invocation of `runCli`.

Prerequisites: Core binds each operation to a Coworker and authorized context. Choose the adapter contract, claim/recovery semantics, and secret-delivery channel before implementation. The developer CLI remains an admin control tool.

Acceptance cases:
- Runtime reads and updates allowed Tasks, creates an authorized follow-up, and starts an authorized Task-linked Masumi Agent Job.
- Unrelated workspace access, forbidden status changes, expired authority, and revoked grants fail.
- Restart and duplicate delivery do not cause duplicate execution or duplicate paid Jobs.
- Offline workers appear unavailable; closing a laptop does not imply hosted execution.
- A second runtime passes the same contract checks before broad framework support is advertised.

### C. Chat participation

[PROPOSED] Add the registered Coworker to authorized direct chats, channels, and groups. Deliver mentions and return replies to the correct conversation.

Prerequisites: choose and verify outbound local transport or an explicitly hosted provider interface. The existing direct-chat path requires a Responses API URL; task polling alone does not implement chat.

Acceptance cases:
- Mention and reply complete end to end in each supported room type.
- Only approved history is supplied; unrelated rooms and revoked memberships remain inaccessible.
- Reconnects do not duplicate replies or route results to a different conversation.
- Local integration does not silently expose public ingress.

### D. x402 purchases through Masumi

[REPORTED: user decision] Allow compatible external x402 services, not only a fixed Sokosumi catalog. Choose workspace credits or a runtime-held wallet explicitly. Never switch funding sources silently.

Prerequisites: define the Core authorization path and Masumi custody/signing contract. Confirm supported networks and assets against the deployed service. Keep Cardano and EVM signing implementations distinct. General resource requests need destination and redirect checks; arbitrary local/private-network access is not implied by external-service support.

Acceptance cases:
- Each supported funding mode completes an approved purchase and reports the actual result.
- Unsupported networks/assets, unauthorized recipients, and excessive amounts fail before spending.
- Signed payment material never leaks to another origin through redirects or error output.
- Retry, timeout, settlement failure, and reconciliation cannot silently double-charge or report an unsettled payment as successful.

### E. Seller pricing and paid graduation

[REPORTED: user decision] The developer specifies usage pricing when applying for the waitlist. New public pricing versions require review. Existing authorized work retains its accepted price and spending ceiling.

Prerequisites: define customer price authorization and seller settlement. Existing usage reporting is not a sufficient public billing contract. Confirm hosted Masumi provisioning, wallet ownership, fees, and payout behavior with the Masumi team; no agreement with Sandro is assumed.

Acceptance cases:
- Metered usage is tied to an authorized customer operation and accepted price version.
- Unapproved amounts or a different payer are rejected; duplicate usage does not produce a duplicate debit.
- Controlled payment proves customer debit, service delivery, and intended seller receipt. A mock receipt is insufficient.
- Missing seller payment configuration blocks paid eligibility, not private registration.
- Only advertised capabilities require their corresponding graduation tests; buyer capability is not mandatory for a seller-only service.

## Readiness and approval

[REPORTED: user decision] Core owns readiness, waitlist applications, and public approval. Derive grants from Core access records, health from connection state, and payment configuration from its canonical owner. Do not duplicate these into a second readiness database.

[PROPOSED] Persist only non-derivable test evidence, tied to the tested configuration version and a validity period. A relevant change invalidates affected evidence. Unknown or stale evidence cannot pass a paid gate.

Eligible does not mean public. Application, review, and explicit administrative approval remain separate. Masumi publication does not confer Sokosumi approval. Global availability does not grant entry to every workspace. Loss of required readiness blocks affected operations and, where required for the offered paid service, paid availability; preserve approval history.

## Security and verification

[REPORTED: user decision] Trusted local sessions are allowed for private development. Public paid operation requires demonstrated isolation from developer credentials. A scoped token, cloud host, or container label alone is not proof.

[PROPOSED] Keep runtime credentials outside model context. Deliver them through a private process channel, not argv. Short-lived credentials remain in memory; any persistent secrets use the OS vault, never preferences, repository files, or logs. Secret-bearing errors must be redacted. The runtime must not fall back to developer authentication.

Future implementation checks use non-production fixtures first. Keep regression tests for authorization, expiry, cross-workspace isolation, duplicate work, billing limits, and full-token redaction. Payment smoke tests require explicit authorization of the environment, payer, recipient, asset, and amount. Tests must distinguish credit debit from seller settlement.

## Least confident decisions

1. [OPEN] MPS seller identity, wallet ownership, and actual Preprod receipt need a live pilot for each intended payment path. Static API types do not prove payout.
2. [CORRECTION, VERIFIED: `apps/cli/src/cli/commands/runtime.ts`, `apps/cli/src/coworker/runtime-credentials.ts`] Runtime key input and command invocation are implemented. Cross-host secret delivery and live host execution remain open. Developer authentication stays separate.
3. [OPEN] Preprod Seat and credit capacity need a live check before participant onboarding. The documented Seat rule does not prove the event Workspace has enough capacity.
4. [OPEN] Local chat transport and recovery require protocol design and framework-specific verification.
