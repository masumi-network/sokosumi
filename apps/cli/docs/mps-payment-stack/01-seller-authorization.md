# MPS seller setup and Task authorization

[PROPOSED] Draft title: `docs(cli): plan MPS seller setup and Task authorization`.

[PROPOSED] Later implementation title: `feat(coworkers): configure MPS sellers and authorize Task payments`.

[PROPOSED] Implementation status: **Planned**. Owner: coordinator. This documentation PR defines the implementation. It contains no payment code.

[REPORTED: coordinator task, 2026-09-30] The user requested three draft implementation briefs. MPS is required.

## Dependency and outcome

[PROPOSED] Branch: `sok-1132-mps-seller-authorization`. Base: `main`.

[VERIFIED: GitHub PR read, 2026-09-30] #5342 merged at `2026-09-30T07:43:45Z` as `c2271e4418faae9f8cae527bc1e29354975c8fa5`. This draft starts after that receipt change.

[PROPOSED] A Vendor admin connects a verified MPS seller. A customer approves fixed terms for one Task. CLI reports readiness and approved amounts. Setup alone must not enable incomplete payments.

## Current evidence

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
| [PROPOSED] Seller authority and readiness | Foreign Vendor, assignment-only caller, wrong network, unverified destination, revoked access rejected | Planned |
| [PROPOSED] Quote authorization | Changed terms, wrong billing account, moved Task, expiry, ceiling breach rejected | Planned |
| [PROPOSED] Debit boundary | Direct unapproved event blocked; concurrent consumption permits one debit; failure preserves approval | Planned |
| [PROPOSED] Secrets and rotation | URL attacks and credential leaks rejected; accepted terms and recovery authority preserved | Planned |
| [PROPOSED] Partial rollout and private use | Direct approved writes remain gated; unpaid private work gains no seller charge | Planned |

## Acceptance and migration preconditions

- [x] [REPORTED: user decisions, 2026-09-30] Use an existing developer-managed MPS seller and encrypted Core storage through self-service CLI setup.
- [x] [REPORTED: user decision, 2026-09-30] Use Task billing-owner approval with original-organization membership and applicable Seat eligibility.
- [ ] [PROPOSED] Demonstrate setup and approval through CLI and Core, including direct API rejection tests.
- [ ] [PROPOSED] Run relevant tests, PostgreSQL race tests, typecheck, build, and Biome. Record exact results; every matrix case remains Planned here.
- [ ] [PROPOSED] Inspect models and full migration history before proposing persistent changes. No migration is assumed. Verify relevant database state read-only. Test any candidate against disposable PostgreSQL and inspect its SQL and existing-row effects.
- [ ] [PROPOSED] Keep customer enablement blocked until lifecycle tests and live payout proof pass.

## Least confident decisions

1. [OPEN] Persistent models, credential rotation, and recovery require implementation review and the migration checks above. Existing payment claims require a debit transaction; they cannot represent an unpaid quote unchanged.
2. [OPEN] V2 quote creation needs an authoritative supported-payment-source index. The registry read response filters sources, while payment creation indexes the original metadata array. Do not infer that index from a filtered response. Source audit: MPS `src/routes/api/registry/agent-identifier/index.ts:24-34` and `src/routes/api/payments/index.ts:180-186` at `ce960265eac56b9d468173e052e64fa4c9e7a2f2`.
3. [OPEN] Seller address decoding and trusted chain checks must bind the wallet key hash to the registration asset. Rollout controls and existing caller compatibility still require verification. No schema change or caller exemption is included in this documentation PR.
