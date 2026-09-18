# Developer CLI implementation plan

Status: proposed implementation; product direction approved in the 2026-09-18 planning conversation. No capability below is declared shipped by this document.

## Goal and scope

[REPORTED: user decision, 2026-09-18] Connect existing framework runtimes as Coworkers through the single Sokosumi developer CLI. Support brief sessions, retained workspace-only registrations, and permanent cloud-hosted workers. Public paid operation is optional.

[REPORTED: user decision] Capabilities have no required completion order. A developer may connect only to test eligibility. Private workspace use has no automatic seller fee; model costs and authorized external purchases still apply. Public paid usage charges customers at approved seller prices.

The contract is [SPEC.md](../SPEC.md). The architecture decision is [ADR 0004](adr/0004-coworker-capabilities-and-graduation.md). Follow those documents before implementing a slice. Use the existing TypeScript CLI and Core HTTP boundary. No new CLI product, recursive CLI dispatch, automatic npm installer, or TUI redesign belongs to this plan.

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

## Delivery units

These units describe independently reviewable outcomes, not a forced user journey. Each implementation PR must first resolve its contract prerequisites, specify exact changed files and runnable checks, and include both allowed and denied scenarios. This direction document is not permission to invent unresolved APIs.

### A. Private registration and connection

[PROPOSED] Extend the existing registration/control flow, then connect one supported runtime to one authorized workspace. First runtime candidate: Claude Code. Verify its current integration interface before selecting packaging.

Owners: CLI controls setup; Core owns Vendor authorization, registration, grants, expiry, and revocation; the runtime adapter owns its connection.

Prerequisites: approve self-service registration and the runtime identity contract. Establish a workspace before registration. Guide a new developer through creating a Vendor with confirmation, or select a Vendor they administer. Do not share one default Vendor among unrelated developers.

Acceptance cases:
- Authorized registration creates a workspace-only Coworker; foreign Vendor ownership is rejected.
- Runtime API calls access only their permitted workspace and never fall back to developer authentication. Trusted private sessions do not promise host-level credential isolation.
- Session expiry and explicit disconnect revoke temporary authority; a crash cannot leave permanent session authority.
- Inactive identity and work history remain after expiry. No shared Task, Job, or message is deleted.
- Reconnection requires authorization. Persistent mode is explicit, not an accidental result of storing a session token.

### B. Active-session operations and automatic execution

[PROPOSED] Support both agent-operated tools during a live session and a connected worker for automatic assignment. Use shared operation handlers, never recursive invocation of `runCli`.

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

1. Runtime credential exchange and command invocation remain proposed. Existing developer authentication guards stay intact until an approved extension specifies the separate runtime boundary.
2. Local chat transport and recovery require protocol design and framework-specific verification.
3. Hosted Masumi provisioning and customer-to-seller settlement require confirmation against the deployed service. No production compatibility or payout claim follows from static API types.
