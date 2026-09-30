# MPS seller setup and Task authorization

[VERIFIED: merged documentation at `40f035984`] Planning title: `docs(cli): plan MPS seller setup and Task authorization`.

[PROPOSED] Implementation title: `feat(coworkers): configure MPS sellers and authorize Task payments`.

[CORRECTION, VERIFIED: local services and checks, 2026-09-30] Status: **Implemented, awaiting PR review**. Seller setup and quote approval are implemented. The earlier pending status described preparation only. Paid execution remains disabled.

[REPORTED: coordinator task, 2026-09-30] The user requested three draft implementation briefs. MPS is required.

## Dependency and outcome

[VERIFIED: local Git checkout] Implementation branch: `sok-1132-mps-seller-implementation`. Rebased from `40f035984` onto main `88a2a3a2c` after the three later main commits. The rebase had no conflicts.

[VERIFIED: GitHub PR read, 2026-09-30] #5342 merged at `2026-09-30T07:43:45Z` as `c2271e4418faae9f8cae527bc1e29354975c8fa5`. This draft starts after that receipt change.

[PROPOSED] A Vendor admin connects a verified MPS seller. A customer approves fixed terms for one Task. CLI reports readiness and approved amounts. Setup alone must not enable incomplete payments.

## Baseline evidence

[VERIFIED: source read at Sokosumi `2ec6554574d85b03845cca24ac87d3bc3992eea5`] These checks establish source behavior, not deployed configuration or successful payments.

- [VERIFIED: source, same ref] `apps/core/src/routes/v1/coworkers/coworker-management-access.ts:44` returns `vendorAdminMembership != null || assignment != null`. Line 53 also permits platform admins. This helper is broader than Vendor-admin seller configuration.
- [VERIFIED: source, same ref] `apps/core/src/routes/v1/tasks/[id]/events/post.ts:159` charges `task.ownerId` and `task.organizationId`. Line 310 states that moving a Task does not rewrite its billing organization.
- [VERIFIED: source, same ref] `apps/core/src/routes/v1/tasks/[id]/events/post.ts:386` accepts `masumiPayment` for a charge. Line 428 creates its claim. Line 520 rejects duplicate blockchain identifiers. A new quote route alone would leave the existing charge entry point reachable.
- [VERIFIED: source, same ref] `apps/cli/SPEC.md:8` requires Core HTTP access. Lines 127, 130, and 133 assign payment authorization to Core, prohibit automatic private-use seller fees, and distinguish customer debit from settlement.

## Requirements

### Seller binding and readiness

[PROPOSED] Require Vendor authority for seller configuration. Reuse membership lookups. Coworker assignment must not authorize payout changes. Specify platform-admin authority before implementation.

[PROPOSED] Bind the Coworker to a verified seller registration, network, payment source, and payout destination. Missing readiness evidence must block payment. Reconnection must not silently select another seller.

[REPORTED: user decisions, 2026-09-30] Connect an existing developer-managed MPS seller. The developer controls the MPS setup and wallet. Use self-service CLI setup. Core stores the scoped MPS credential encrypted. Sokosumi does not provision a wallet or create a registry registration in this slice.

[PROPOSED] Use a dedicated encryption key ring for seller credentials. Bind encrypted credentials to the immutable seller configuration. Keep MPS credentials outside the runtime, model output, arguments, logs, and ordinary configuration. Keep old encryption keys and MPS key identities available for funded-payment recovery.

[REPORTED: source audit at MPS `ce960265eac56b9d468173e052e64fa4c9e7a2f2`] `src/routes/api/payments/submit-result/index.ts:64-68` checks wallet scope and the creating API-key identity or admin authority. A replacement API-key identity must not silently remove recovery authority for funded work.

[PROPOSED] Verify the supplied key's read/pay authority and selected network and wallet scope. Reject admin and unscoped seller keys. Check registration, selected payment source, NFT ownership, and payout identity through trusted chain data. Developer-node responses alone cannot establish those facts. A successful setup check is a snapshot, not proof of signing or settlement.

### Fixed quote and customer approval

[PROPOSED] Core obtains the MPS quote. Before approval, show the Task, seller destination, amounts, deadlines, and credit ceiling. Runtime-reported amounts do not constitute approval.

[PROPOSED] Preserve the accepted terms. Bind approval to the Task, Coworker, accepted seller terms, payment identifier, network, and billing account. Use the Task's billing owner and organization. Workspace movement must not substitute another payer. Validate the customer's authority over that account.

[REPORTED: user decision, 2026-09-30] The Task billing owner approves the fixed quote. Organization payments require membership and applicable Seat eligibility in the Task's original billing organization. Organization owner/admin rank is not required. Personal payments also require the Task billing owner.

[VERIFIED: source at `ebe21986ce433d9736f537cf1332b61404b5e577`] `packages/database/src/helpers/credit-bucket-scope.ts:50-68` uses membership and applicable Seat eligibility for shared-pool access. This existing eligibility does not constitute consent to a new quote.

[PROPOSED] Private work remains free of automatic seller fees. Explicit paid approval is required for this fixed-quote path. Seller setup, Task assignment, or sufficient balance must not imply approval.

### Enforcement and partial rollout

[PROPOSED] Enforce approval at every MPS payment entry point, including `masumiPayment` event writes. Inventory existing callers. Do not introduce an undocumented compatibility bypass.

[VERIFIED: source at `ebe21986ce433d9736f537cf1332b61404b5e577`] `apps/core/src/middleware/auth.ts:224-230` includes direct Coworkers and Soko Bots in `isAgentAuthContext`. Approval enforcement must cover both, including payment events without a status change.

[PROPOSED] Check terms, expiry, revocation, billing identity, and the server-calculated credit ceiling inside the debit transaction. Consume approval with the debit, Task event, and claim. Failed charges must not consume approval. Concurrent requests must not consume it twice.

[PROPOSED] Keep the new paid flow unavailable until PR 2 provides funding recovery, result submission, settlement, and refund reconciliation. Customer enablement also requires PR 3's live proof. A stored approval must not make direct event writes usable during partial rollout. Test that gate independently of CLI behavior.

### Credentials and configuration changes

[PROPOSED] Keep secrets outside arguments, model output, logs, ordinary configuration, and URLs. Inspect existing secret storage before reuse. For remote nodes, reject unsafe resolved destinations and credential forwarding through redirects.

[PROPOSED] Apply redirect rejection and request-specific secret redaction on both CLI-to-Core and Core-to-MPS requests. The normal Core authentication token and the submitted seller credential need separate redaction.

[PROPOSED] Configuration changes must not rewrite accepted destinations or prices. Changed terms require reapproval. Rotation must preserve funded-payment recovery. Revocation blocks future spending without abandoning existing obligations.

## Proposed scope and reuse

[PROPOSED] Extend Core Coworker routes and schemas, then Task payment authorization. Reuse `apps/core/src/services/task-payment-claim.service.ts` and `packages/masumi/src/clients/masumi-payment.client.ts`. Preserve one debit and purchase path.

[PROPOSED] Extend `apps/cli/src/cli/commands/coworkers.ts`, customer Task commands, API services, and `apps/cli/skills/sokosumi/SKILL.md`. Regenerate `packages/core-client/src/generated/` after source API changes. Exact new files follow the persistent model, encryption, and recovery design.

[PROPOSED] Exclude runtime execution, seller result delivery, refund processing, public metered pricing, x402, and global listing approval. Those exclusions must not weaken the rollout gate. Do not edit `SPEC.md` in this draft.

## Test matrix

| Proposed case | Required evidence | Status |
| --- | --- | --- |
| [REPORTED: reviewer suites] Seller authority and readiness | Foreign Vendor, assignment-only caller, wrong network, unverified destination, revoked access rejected | Covered by fixture tests; live proof pending |
| [VERIFIED: quote service suite] Quote authorization | Changed terms, wrong billing account, moved Task, expiry, ceiling breach rejected | 40 service tests passed |
| [VERIFIED: PostgreSQL suite] Debit boundary | Concurrent requests create one intent and one seller POST; concurrent approvals cannot replace consent | 4 integration tests passed; funding and consumption belong to PR 2 |
| [REPORTED: credential and transport suites] Secrets and rotation | URL attacks and credential leaks rejected; binding context authenticated | Fixture tests passed; live key rotation pending |
| [REPORTED: event suite] Partial rollout and private use | Direct approved writes remain gated; ordinary credit events retain their tests | 84 event tests passed |

## Current implementation step

[CORRECTION, VERIFIED: `packages/net/src/ssrf-fetch.ts`, `packages/masumi/src/clients/masumi-seller.client.ts`] The earlier transport-only status is superseded. Seller verification and quote requests now use `redirect: "error"`. Existing callers retain their default redirect behavior.

[VERIFIED: `packages/net/src/ssrf-fetch.test.ts`, 2026-09-30] Invariant NET-1: a request with `redirect: "error"` rejects every 3xx response and makes no request to its redirect destination. The rejection message contains neither request credentials nor the redirect URL. Fixture tests cover GET, HEAD, POST, missing Location headers, and non-3xx responses. These tests do not exercise a live MPS node.

[VERIFIED: local commands, 2026-09-30] With only the source restored to `HEAD`, `pnpm --filter @sokosumi/net test src/ssrf-fetch.test.ts` returned exit 1: `Tests 11 failed | 24 passed (35)`. After restoring the changed source, `pnpm --filter @sokosumi/net test` returned exit 0: `Tests 39 passed (39)`, `Test Files 2 passed (2)`. Package typecheck and build each returned exit 0. Biome reported `Checked 2 files` and `No fixes applied.`

[REPORTED: reviewer source audit, 2026-09-30] Generated MPS clients accept an injected `fetch`. `getApiKeyStatus`, `getWalletList`, `getPaymentSource`, `getRegistryAgentIdentifier`, and `getBalance` provide read checks for seller setup. Read responses are a snapshot, not proof of signing or settlement. Core has no general seller-secret backend identified by this audit.

[REPORTED: reviewer source audit, 2026-09-30] `apps/cli/src/api/http-client.ts:116-138` follows redirects and redacts the human authentication token. Sending an MPS key through CLI setup also requires redirect rejection and request-specific secret redaction on the CLI-to-Core request.

[REPORTED: user decision, 2026-09-30] Use developer self-service setup through CLI. Core stores the scoped MPS credential encrypted. Do not reuse buyer-node credentials or put seller keys in Coworker metadata. Runtime credentials remain separate.

[PROPOSED] Owner: coordinator. Reuse the generated MPS client, Core's Vendor-admin membership checks, and CLI's HTTP transport. Use a dedicated, versioned deployment encryption key ring for seller credentials. Bind ciphertext to its immutable seller connection. Retain old encryption keys and MPS key identities for funded-payment recovery.

[VERIFIED: preparation checks, 2026-09-30] `apps/core/src/lib/mps-seller-credentials.ts` implements AES-256-GCM with a dedicated key ring and authenticated binding context. `pnpm --filter core test src/lib/mps-seller-credentials.test.ts` returned `Tests 69 passed (69)`. Preparation typecheck returned `20 successful, 20 total`, with `13 cached, 20 total`. Those checks covered the helper before integration.
[CORRECTION, VERIFIED: `apps/core/src/services/mps-seller.service.ts`] The helper now encrypts credentials for persisted seller bindings. Setup requires `MPS_SELLER_ENCRYPTION_SECRET`; no runtime receives that value or the seller key.

[REPORTED: implementation reviewer regression probe, 2026-09-30] Removing the context values from authenticated data caused `9 failed | 60 passed (69)`. Restoring the source returned `69 passed (69)`.

[REPORTED: CLI reviewer, 2026-09-30] The local user checkout includes a `runtime pay --confirm-payment` prototype. It posts payment terms with Coworker credentials after Task completion. It does not implement customer quote approval or funding before work. Preserve that checkout. Build the paid flow against the merged CLI and Skills in `ebe21986ce433d9736f537cf1332b61404b5e577`.

### Storage audit and proposed records

[REPORTED: database reviewer, source `700d02f10974d0b80dd0802a59dbb353090ac5c0`, 2026-09-30] The audit read all 410 migration SQL files, totaling 628,884 bytes. It traced historical table definitions, drops, renames, and payment constraints. It did not execute migrations or inspect a database. Target database state remains unknown.

[VERIFIED: initial database checks, 2026-09-30] The configured loopback database returned `ECONNREFUSED`; its state remains unknown. A separate PostgreSQL 17 instance on a private Unix socket applied the initial 410 migrations. A read-only query returned `applied_migrations: 410`. `pnpm --filter @sokosumi/database prisma:check-drift` returned exit 0 and `-- This is an empty migration.` These results describe the initial disposable baseline, not Preprod or the configured local database. The candidate audit below supersedes the earlier no-migration status.

[VERIFIED: `packages/database/prisma/schema.prisma:306,2622,3365`] `VendorGrant` records Workspace access. `SokoBotPendingDecision` requires a Soko Bot and turn. `TaskPaymentClaim.transactionId` is required. None of these records represents an unpaid Coworker quote with a verified seller binding.

[PROPOSED] Add one seller binding version and one Task quote record. The binding preserves seller configuration and a protected credential reference. The quote preserves that binding, original billing identity, accepted terms, ceiling, expiry, approval, revocation, and consumption state. Reuse the existing debit and claim. This is a proposed model shape, not an approved migration.

[REPORTED: database reviewer] `apps/core/src/routes/v1/tasks/[id]/events/post.ts:283` opens the existing Serializable transaction. Approval consumption belongs with its debit, Task event, and claim. External MPS requests must stay outside that transaction. `apps/core/src/helpers/user-deletion-tasks.ts:242,257` blocks pending claims and removes terminal claims. Consumption must survive deletion of a terminal claim. Original billing snapshots must also survive a nullable organization relation.

## Implementation contracts

[PROPOSED: coordinator, 2026-09-30] Implement against merged main `40f035984`. Reuse strict Vendor-admin membership, Task ownership, original-organization Seat checks, the generated MPS clients, and the existing payment claim path. Seller configuration grants no platform-admin exemption and no spending permission.

1. Core stores immutable `CoworkerMpsSellerBinding` versions. One active version exists per Coworker and network. Replacement revokes the previous version without deleting its encrypted credential. A dedicated deployment key ring encrypts the scoped seller key.
2. Core stores `TaskMpsPaymentQuote` before requesting seller terms. A caller-supplied idempotency key identifies that request. An uncertain remote result never causes another payment POST. Quote terms and original billing identity stay fixed. Customer approval requires the displayed terms hash and credit ceiling.
3. `POST /v1/coworkers/{id}/mps-seller` accepts the endpoint, registry identifier, wallet ID, payment source ID, and API key. GET returns an allowlisted public status. POST to `/revoke` takes the binding ID. CLI supplies the key through stdin only and rejects redirects.
4. Task quote routes create, inspect, approve, and revoke quotes. All `masumiPayment` event writes remain disabled in this implementation until funded execution and recovery are complete. Existing claim recovery stays available.

[PROPOSED: file ownership] Coordinator owns schema, migrations, Core services/routes/schemas, configuration, and this record. The Core reviewer owns `helpers/mps-payment-access.ts` and tests. The MPS implementer owns `clients/masumi-seller.client.ts` and tests. The CLI implementer owns the existing transport and its tests. Shared interfaces change through the coordinator.

[VERIFIED: local database check, 2026-09-30] The configured loopback database still returned `ECONNREFUSED`. Its state remains unknown. The disposable database applied all 411 existing migrations, then `20260930160001_mps_seller_and_task_quote`. Candidate SQL creates two tables, seven indexes, and four foreign keys. It does not alter existing rows or columns. Post-apply drift returned `-- This is an empty migration.` No shared database changed.

### Implemented quote contract

[VERIFIED: `apps/core/src/services/task-mps-payment-quote.service.ts`]
Quote creation requires four explicit ISO deadlines. MPS requires minimum gaps of 5, 15, and 15 minutes.
The result deadline must stay at least 15 minutes ahead when the node receives the request.
The request is persisted before one seller POST. Reusing the request ID and deadlines performs read-only recovery.
Known seller rejection returns `422`. Unknown outcomes retain an unresolved intent.
Review and approval expire after at most 15 minutes. Approval requires the exact terms hash and a credit ceiling.
It creates no debit, claim, or consumed quote.

[VERIFIED: quote regression command, 2026-09-30]
`pnpm --filter core test src/services/task-mps-payment-quote.service.test.ts` returned `5 failed | 35 passed (40)` before the deadline/error fix.
After the fix it returned `40 passed (40)`. These service tests mock storage and the MPS client.

[REPORTED: independent reviewers, 2026-09-30]
Seller verification tests returned `95 passed`. Removing quote guards caused `2 failed | 93 skipped (95)`.
Task route tests returned `33 passed`. Restoring the old selected-organization Seat middleware caused `1 failed | 29 passed (30)`.
CLI payment tests returned `84 passed`; reverting command sources caused `8 failed | 1 passed (9)`.
These are local fixture and route checks, not a live seller payout.

[VERIFIED: final local checks before the rebase, 2026-09-30]
`pnpm --filter core test` returned `700 passed | 13 skipped (713)` files and `8673 passed | 155 skipped (8828)` tests.
`pnpm --filter @masumi_network/sokosumi test:ci` returned `498 passed, 0 failed`.
Core and Web typecheck each exited `0`. Core and CLI build returned `9 successful, 9 total` Turbo tasks.
Biome returned `Checked 5207 files in 10s. No fixes applied.` Migration ordering returned `14 passed (14)`.
Documentation and migration CI tests returned `3 passed, 0 failed`.
The opt-in PostgreSQL suite returned `4 passed (4)` with mocked MPS calls and real storage.
Skipped tests and a live seller payout are not covered by these results.

[CORRECTION, VERIFIED: local regression checks]
Approval previously accepted precision that Core rounded away, so CLI could report failure after saving consent.
Both boundaries now reject more than 10 decimal places before the write.
Core route tests failed `2 failed | 33 passed (35)` before the change and passed `35 passed (35)` afterward.
The combined run also exposed slow fixture compression in one Masumi test.
[REPORTED: package reviewer] Precomputed samples preserve the rejection checks; the full suite then returned `519 passed (519)`.

[CORRECTION, VERIFIED: PR #5474 CI run `36701678509` and local reproduction]
The first CI run failed because the new PostgreSQL test accepted only the local database name `mps_baseline`.
CI uses `job_sync_test`. The guard now accepts both names and still requires loopback access.
Against a disposable `job_sync_test`, the old guard returned `Test Files 1 failed (1)` and `Tests 4 skipped (4)`.
After the fix, the same suite returned `Tests 4 passed (4)`. Application source did not change for this fix.

[CORRECTION, VERIFIED: main merge and disposable PostgreSQL, 2026-09-30]
Main advanced to `17746d664` with a later migration. The draft merged that commit without conflicts.
The migration-order check then returned `1 failed | 13 passed (14)` because this draft's migration sorted before the new baseline.
Its folder is now `20260930180000_mps_seller_and_task_quote`; its SQL is unchanged.
The ordering check returned `14 passed (14)` after the rename.
A fresh disposable database applied all 413 migrations. Drift returned `-- This is an empty migration.`
These checks cover the combined history. The earlier 411-baseline result describes the previous main revision.

## Acceptance and migration preconditions

- [x] [REPORTED: user decisions, 2026-09-30] Use an existing developer-managed MPS seller and encrypted Core storage through self-service CLI setup.
- [x] [REPORTED: user decision, 2026-09-30] Use Task billing-owner approval with original-organization membership and applicable Seat eligibility.
- [x] [REPORTED: CLI and Core reviewers] Fixture tests exercise setup and approval commands and direct API rejection. Live seller setup remains unverified.
- [x] [VERIFIED: commands above] Relevant suites, PostgreSQL races, typecheck, build, and Biome passed locally. The results do not establish deployed payment capability.
- [x] [VERIFIED: disposable PostgreSQL logs and candidate SQL] All 411 baseline migrations and the candidate applied. Drift is empty. Existing rows need no transformation. The configured local database is unavailable; no shared database was targeted.
- [x] [VERIFIED: `apps/core/src/routes/v1/tasks/[id]/events/post.ts`] MPS events return `422` with kind `mps_payments_disabled` for Coworkers and Soko Bots. Existing claim recovery remains intact.

## Least confident decisions

1. [OPEN] Live setup, key rotation, signing, and seller payout still need proof. Read-only verification cannot establish successful settlement. Quote decoding rejects identifiers above 1,024 compressed bytes or 4,096 decoded characters. It does not attest the COSE signature; the buyer must verify it before funding.
2. [VERIFIED: `packages/masumi/src/clients/masumi-seller.client.ts`] V2 uses the trusted registry's explicit `sourceIndex`, never a filtered-array position. Fresh trusted MPS checks verify pricing and registration NFT ownership. [OPEN] The registry backend's freshness is not independently established by these tests.
3. [PROPOSED: PR 2 prerequisites] Carry the approved `sellerReturnAddress` through claim creation and purchase. Block Task/user deletion while funded work remains unsettled. The current user-deletion path can delete a purchased claim; do not enable funding before fixing that path. Keep approval consumption independent of claim deletion.
