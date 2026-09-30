# Coworker MPS Seller Receipt (SOK-1132)

[REPORTED: SOK-1132 requirement] Goal: prove the intended developer wallet receipt for a Coworker Task on Cardano Preprod. A `PURCHASED`/`FundsLocked`/`RefundWithdrawn` state or a mock receipt does not count as live acceptance proof.

[CORRECTION, VERIFIED: merged source `c2271e441`, 2026-09-30] [#5342](https://github.com/masumi-network/sokosumi/pull/5342) merged the Core receipt route and CLI reader. This is receipt reading only. [VERIFIED: `apps/cli/src/coworker/runtime-task.ts:195-203`] CLI completion posts status and result text without `masumiPayment`. [OPEN] Paid runtime execution and intended seller wallet proof remain pending.

[VERIFIED: `apps/core/src/helpers/coworker-task-receipt.ts:71,113-122`, at `c2271e441`] The reader checks stored purchase terms, then maps MPS settlement state. `settled` is true for `Withdrawn`, or `DisputedWithdrawn` with nonempty `WithdrawnForSeller`. `txHash` comes from `CurrentTransaction` and can be null even when settled. [CORRECTION] The earlier text incorrectly promised a transaction hash for every plain `Withdrawn` response.

[VERIFIED: draft branch contents, 2026-09-30] The next drafts contain planning documents and corrections to existing guides: [#5463 seller authorization](https://github.com/masumi-network/sokosumi/pull/5463), [#5464 paid runtime](https://github.com/masumi-network/sokosumi/pull/5464), and [#5465 plugin flow and proof](https://github.com/masumi-network/sokosumi/pull/5465). These drafts do not complete the payment path.

[CORRECTION, REPORTED: user decisions, 2026-09-30] The first flow will use an existing developer-managed MPS seller. Self-service CLI setup will store its scoped credential encrypted in Core. The Task billing owner will approve each fixed quote. Organization approval will require membership and applicable Seat eligibility in the original billing organization. Implementation and live seller proof remain pending.

## Why this reuses existing infra

[REPORTED: earlier code review, 2026-09-29] The following rationale preceded #5342.

- Jobs already read settlement state. `apps/core/src/services/job-sync.service.ts` resolves the purchase with `paymentClient().getPurchaseByBlockchainIdentifier(...)`, checks it with `doesPurchaseMatchJobTerms`, then maps MPS `onChainState` (including `Withdrawn`) through `transformPurchaseToJobUpdate` (`apps/core/src/helpers/purchase.ts`). `paymentClient` (`apps/core/src/clients/masumi-payment.client.ts`) wraps `@sokosumi/masumi` `createPaymentClient` and reads `PAYMENT_API_URL` / `PAYMENT_API_KEY`.
- Historical Task gap. `TaskPaymentClaim` tracks `PENDING | PURCHASED | REFUNDED`. [CORRECTION, VERIFIED: `apps/core/src/helpers/coworker-task-receipt.ts:71-124`] Core now reads settlement through MPS on demand. The earlier statement that Core cannot observe Task settlement is stale.
- `paymentClient().resolveMasumiTaskPaymentPurchase(payload)` resolves a Task claim's purchase and returns `err({ kind: "mismatch" })` unless the purchase matches the claim's stored terms (`doesPurchaseMatchRequest`: seller vkey, amounts, times, input hash). The purchase row carries `onChainState`, `WithdrawnForSeller[]` and `CurrentTransaction.txHash`.

So the minimal change resolves the Task claim's purchase on demand through the same terms-checked seam the claim sync already uses.

## Merged change

[VERIFIED: source at `c2271e441`] These sections describe the merged implementation. They do not establish deployment or live payment results.

### Core (reuses `paymentClient` and the claim payload parser)

1. Helper `apps/core/src/helpers/coworker-task-receipt.ts`:
   - `resolveTaskSellerReceipt(taskId, db, { signal })`: read the latest `TaskPaymentClaim` for the task (`where: { taskEvent: { taskId } }`), then `paymentClient().resolveMasumiTaskPaymentPurchase(parsePurchasePayload(claim.purchasePayload))` with a 20 s timeout combined with the request abort signal.
   - Return `{ blockchainIdentifier, claimStatus, onChainState, settled, txHash, withdrawnForSeller }`, where `settled` is `Withdrawn`, or `DisputedWithdrawn` with a non-empty `WithdrawnForSeller`.
   - The claim read is scoped to this deployment's `NETWORK`, like the claim sync.
   - No purchase on the node (`not_found`) returns `settled: false` unless the claim is `PURCHASED`; then the 404 is a node fault and returns 502. A mismatch on a claim the sync already refunded also returns `settled: false`. Any other node failure or terms mismatch throws 502, so an outage never reads as a proven non-payment. An unreadable stored payload returns 500.
   - [CORRECTION, VERIFIED: helper lines 46-51] The reader reports only the newest claim. Older claims are omitted. The newest claim can be settled or unsettled. The earlier text incorrectly said an older settled claim would read as `settled: false`.
2. Route `GET /v1/tasks/{id}/receipt` (`apps/core/src/routes/v1/tasks/[id]/receipt/get.ts`), coworker-readable via `requireTaskReadForRouteVars`, returns the helper output through a Zod/OpenAPI schema. It mounts after `GET /{id}`, which cannot match `/{id}/receipt`.

### CLI (reads existing coworker client)

3. `runtime receipt --coworker-id ID TASK_ID`: `GET /v1/tasks/{id}/receipt`, print the whole receipt (`blockchainIdentifier`, `claimStatus`, `onChainState`, `settled`, `txHash`, `withdrawnForSeller`) with `--json`, and surface `txHash` for independent Preprod verification. `txHash` is set only when `settled` is true. `settled: false` is a valid result (exit 0); the agent branches on the field. `--organization-id` is not accepted.

[VERIFIED: `apps/core/src/helpers/coworker-task-receipt.ts:71`, `apps/cli/src/cli/commands/runtime.ts:258-276`] Core reuses the existing payment client. The CLI calls Core for the receipt.

[VERIFIED: `apps/cli/package.json:2-18,30-36`, at `c2271e441`] The source manifest declares version `1.0.2`, public access, Node.js 24, and `dist` plus `skills`. It has no Masumi package dependency. [OPEN] This review did not check npm's current release or a fresh registry installation.

## Acceptance criteria (SOK-1132)

[CORRECTION, VERIFIED: `apps/core/src/helpers/coworker-task-receipt.ts:113-122`] The earlier checked boxes conflated implemented state mapping with live acceptance. The helper does not detect mocked data. A mocked `Withdrawn` response can satisfy its state check. Mock fixtures do not count as the required live payment proof.

- [x] [VERIFIED: helper lines 113-122] Implement MPS settlement-state mapping. Claim status `PURCHASED` alone does not set `settled`.
- [x] [VERIFIED: helper lines 113-122; CLI `runtime.ts:265-274`] Exclude `FundsLocked` and `RefundWithdrawn`; expose a transaction hash when MPS supplies one.
- [ ] [OPEN] Prove one delivered Coworker Task through the final terms-checked route and CLI command on Preprod.
- [ ] [OPEN] Tie that payment to the intended seller wallet and independently verify its settlement transaction and amount.

## Reported Preprod reads, 2026-09-29

[REPORTED: earlier receipt review, 2026-09-29] The earlier document recorded these live Preprod MPS reads. This documentation update did not repeat them. The lookup used `POST /api/v1/purchase/resolve-blockchain-identifier`:

- A real `Withdrawn` purchase → this change reports `settled: true` with the real settlement `txHash`.
- A real `RefundWithdrawn` purchase → `settled: false` (a refund is correctly not a seller receipt).
- `WithdrawnForSeller` came back **empty** on this node even for `Withdrawn` purchases, confirming `settled` must key off `onChainState`, not that array. The settlement `txHash` came from `CurrentTransaction.txHash`.

[CORRECTION, REPORTED: review, 2026-09-29] The reads above used the unchecked `getPurchaseByBlockchainIdentifier` lookup. [VERIFIED: helper line 71] The merged helper uses `resolveMasumiTaskPaymentPurchase` with stored terms. [OPEN] The final route has not been reverified with a real Coworker Task claim in this record. The older reads do not close end-to-end acceptance.

## Follow-ups (from a masumi-cli / MPS cross-reference)

[CORRECTION, PROPOSED] Resolve the required evidence before closing live acceptance. The earlier blanket statement that these items were unnecessary for the pilot was too broad.

- Transaction evidence. [VERIFIED: helper line 122] The current hash can be null. [REPORTED: earlier MPS review] MPS transaction history can supply confirmation evidence. [PROPOSED] Verify the required history fields and transaction state before selecting a receipt-proof contract. Historical reads do not establish current hash availability.
- Paid amount. [VERIFIED: helper lines 104-123] Amounts come only from `WithdrawnForSeller`. [REPORTED: earlier node reads] That array was empty for plain `Withdrawn`. [PROPOSED] Resolve the actual seller amount for live acceptance.
- Confirmation requirement. [VERIFIED: helper lines 113-115] Settlement mapping does not require a confirmed transaction record. [OPEN] Define how the live proof verifies confirmation independently of this state flag.
- Multiple claims. [VERIFIED: helper lines 46-51] The reader selects the newest claim. [PROPOSED] Bind proof to the accepted payment when implementing retries or later charges.

## References

[REPORTED: original tracking] SOK-1132, SOK-909, SOK-1180. [REPORTED: earlier upstream review] MPS `billing.ts` and `payments/income` informed the original mapping. Recheck upstream behavior when implementing the payment lifecycle.

## Least confident decisions

1. [OPEN] Seller credential rotation and recovery require implementation review. Live verification must establish the selected wallet and payout destination.
2. [OPEN] The confirmation and amount evidence needed for a durable wallet receipt require a live Task test.
3. [OPEN] The newest-claim assumption needs review before automatic retries or multiple Task charges become supported flows.
