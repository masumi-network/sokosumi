# MPS paid Task lifecycle

[PROPOSED] Status: Planned. Owner: coordinator. Implementation and validation remain pending.

[PROPOSED] Planning PR title: `docs(cli): plan the MPS paid Task lifecycle`. Later implementation title: `feat(coworkers): execute and settle MPS paid Tasks`.

[PROPOSED] Branch: `sok-1132-mps-paid-runtime`. Base and dependency: PR 1, `sok-1132-mps-seller-authorization`. Its seller binding and customer approval contract must be accepted first.

## Baseline evidence

[VERIFIED: source read at Sokosumi `2ec6554574d85b03845cca24ac87d3bc3992eea5`] `apps/cli/src/coworker/runtime-task.ts:200-203` posts `{ status: "COMPLETED", comment: result }`. Both generic completion and Hermes execution use this handler (`:212-237`).

[VERIFIED: same baseline] `apps/core/src/routes/v1/tasks/[id]/events/post.ts:386-464` charges credits and creates the claim inside one transaction. `apps/core/src/services/task-payment-claim.service.ts:453-506` resolves an uncertain purchase before another attempt.

[VERIFIED: same baseline] `task-payment-claim.service.ts:171-208` refunds a `PENDING` claim and rejects an already purchased claim. This path does not reconcile subsequent on-chain refunds. `helpers/coworker-task-receipt.ts:49-53` selects the newest claim; `:122` reads `CurrentTransaction?.txHash`.

[VERIFIED: MPS source at `ce960265eac56b9d468173e052e64fa4c9e7a2f2`] `src/routes/api/payments/submit-result/index.ts:38-91` checks payment state and creator/admin authority, then queues `SubmitResultRequested`. V2 automatic collection requires `AUTO_WITHDRAW_PAYMENTS` and eligible state (`packages/payment-source-v2/src/services/payments/automatic-decisions/service.ts:27-59`). These reads do not establish deployed settings.

## Requirements

1. [PROPOSED] Identify and fund the approved payment. Every write, read, and recovery action must select the same claim. Bind its identifier to the Task, Coworker, network, seller, payout destination, original payer, and approval. Retain the signed blockchain identifier unchanged. Freeze approved asset amounts, credit ceiling, quote expiry, deadlines, and accepted price. Reuse atomic claim/debit processing to consume approval. Task moves or seller changes must not replace accepted terms.

2. [PROPOSED] Confirm funding before execution. Core must verify matching escrow terms and confirmed locked funds before permitting paid work. `PURCHASED` alone is insufficient. Check assignment, Workspace access, cancellation, and deadlines again before starting. Preserve existing free execution. No automatic seller fee applies to private own-workspace work.

3. [PROPOSED] Deliver once and submit the agreed result. Reuse shared generic/Hermes handlers. Persist delivered output, its event identifier, and its payment link before recoverable seller submission. Define exact input canonicalization, purchaser nonce handling, UTF-8 encoding, and result hashing against the selected protocol. Store the accepted hashes. Retry submission of that same result without executing work or charging again. Changed output needs an explicit conflict outcome.

4. [PROPOSED] Collect and prove payout. Core submits the result through the chosen seller integration and tracks collection after unlock conditions. Preserve creator/admin authority when MPS credentials rotate. Verify confirmed transaction evidence, actual destination, and paid asset amounts. Report partial seller payout separately from full payment. Task completion, result submission, pending collection, and confirmed payout must remain separate outcomes.

5. [PROPOSED] Reconcile failure and refunds. Resolve uncertain writes before another attempt. Retain payment identity after timeouts, restarts, and lost responses. Unknown node state must remain unknown. Confirmed full or partial refunds must reconcile against the original customer debit, including earlier compensation. Credit only the unreconciled amount under an agreed fee, exchange-rate, and rounding policy. Enforce duplicate protection transactionally. Cancellation must not imply that locked funds were refunded.

[PROPOSED] CLI uses Core HTTP with `coworker_*` credentials. Keep vault/stdin handling and secret redaction. The runtime must never receive MPS wallet secrets, reuse developer credentials, or rotate its own key. If authority disappears after funding, preserve work and payment evidence for authorized recovery. Do not blindly retry or generate a replacement payment.

[REPORTED: user decisions, 2026-09-30] Use an existing developer-managed MPS seller. The developer controls its node and wallet. Self-service CLI setup stores its scoped MPS credential encrypted in Core. PR 1 defines seller binding and Task billing-owner approval. An operator-supplied terms file alone does not complete this lifecycle.

## Proposed file scope

- [PROPOSED] Extend `apps/cli/src/coworker/runtime-task.ts`, `src/cli/commands/runtime.ts`, help/discovery, and their tests. Add typed payment reads through the existing HTTP client.
- [PROPOSED] Extend Core Task payment routes, `task-payment-claim.service.ts`, receipt helper/routes, and their tests. Add durable seller submission and refund reconciliation through those existing services.
- [PROPOSED] Extend `packages/masumi/src/clients/masumi-payment.client.ts` for required seller operations. Regenerate Core client artifacts from approved schemas.
- [PROPOSED] Update `apps/cli/skills/sokosumi/SKILL.md` and README instructions with implemented commands and recovery states.

## Test matrix

| Status | Layer | Required evidence |
| --- | --- | --- |
| [PROPOSED] Planned | Unit | Hash vectors; immutable terms; expired quotes; insufficient credits; foreign payment identity; no execution before confirmed funding. |
| [PROPOSED] Planned | CLI integration | Generic/Hermes parity; one JSON document; secret redaction; revoked keys; pending and unknown responses. |
| [PROPOSED] Planned | Disposable PostgreSQL | Concurrent funding consumes one approval and creates one debit. Lost commit responses preserve payment identity. |
| [PROPOSED] Planned | Disposable PostgreSQL | Restart after output storage resumes seller submission. Credential rotation preserves authority or reports the missing authority. |
| [PROPOSED] Planned | Disposable PostgreSQL | Full/partial refunds, duplicate reconciliation, prior compensation, and Task moves preserve the original payer and credit limits. |
| [PROPOSED] Planned | Controlled Preprod | Authorized funding, confirmed lock, delivered output, seller submission, collection, and confirmed destination/amount/transaction. Repeat recovery and prove no second debit. |

[PROPOSED] Inject cancellation, deadline expiry, node outages, and lost responses at every external-write boundary. Mocks cannot replace Preprod proof. That test requires approved credentials, amount, target, and procedure.

## Schema prerequisites and non-goals

[PROPOSED] Inspect Prisma schema and the full migration history before proposing storage. Check target state read-only when relevant. Unknown target state blocks the schema decision. Prove each required change; test the complete history and candidate on disposable PostgreSQL. Inspect every SQL statement, existing-row effects, and schema consistency.

[PROPOSED] Exclude public listing, metered pricing, x402, Mainnet rollout, autonomous key minting, package publication, and deployment. Do not build another escrow state machine.

## Acceptance checklist

- [ ] [PROPOSED] One approved payment remains identifiable across funding, execution, settlement, and recovery.
- [ ] [PROPOSED] Submission retries cannot repeat work, debit twice, or overcredit refunds.
- [ ] [PROPOSED] Confirmed payout identifies destination, asset amounts, and transaction; uncertainty stays explicit.
- [ ] [PROPOSED] Planned tests pass with recorded evidence before customer enablement.

## Least confident decisions

1. [OPEN] Recovery authority after MPS credential rotation, including retention of the creating API-key identity.
2. [OPEN] Required chain confirmations, rollback handling, and collection settings.
3. [OPEN] Input/result hash format and authoritative output storage.
4. [OPEN] Partial-refund conversion, fees, rounding, and additional persistence requirements.
