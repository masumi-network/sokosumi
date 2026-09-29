# Coworker MPS Seller Receipt (SOK-1132)

Goal: prove the intended developer wallet receipt for a Coworker Task on Cardano Preprod. A `PURCHASED`/`FundsLocked`/`RefundWithdrawn` state or a mock receipt does not count. `settled` matches the Masumi Payment Service definition (`billing.ts` / `income`): true on `onChainState == "Withdrawn"`, or on `DisputedWithdrawn` when `WithdrawnForSeller` is non-empty. A plain `Withdrawn` reports the settlement transaction hash; `WithdrawnForSeller` is best-effort node metadata and is empty for a plain `Withdrawn` (see Verified on Preprod).

## Why this reuses existing infra

[VERIFIED: code read, 2026-09-29]

- **Jobs already prove settlement.** `apps/core/src/services/job-sync.service.ts` resolves the purchase with `paymentClient().getPurchaseByBlockchainIdentifier(...)`, checks it with `doesPurchaseMatchJobTerms`, then maps MPS `onChainState` (including `Withdrawn`) through `transformPurchaseToJobUpdate` (`apps/core/src/helpers/purchase.ts`). `paymentClient` (`apps/core/src/clients/masumi-payment.client.ts`) wraps `@sokosumi/masumi` `createPaymentClient` and reads `PAYMENT_API_URL` / `PAYMENT_API_KEY`.
- **Coworker Tasks do not.** They only have `TaskPaymentClaim` (`PENDING | PURCHASED | REFUNDED`, `model TaskPaymentClaim` in `packages/database/prisma/schema.prisma`). Core "cannot observe settlement" for them yet.
- `paymentClient().resolveMasumiTaskPaymentPurchase(payload)` resolves a Task claim's purchase and returns `err({ kind: "mismatch" })` unless the purchase matches the claim's stored terms (`doesPurchaseMatchRequest`: seller vkey, amounts, times, input hash). The purchase row carries `onChainState`, `WithdrawnForSeller[]` and `CurrentTransaction.txHash`.

So the minimal change resolves the Task claim's purchase on demand through the same terms-checked seam the claim sync already uses.

## Change

### Core (reuses `paymentClient` and the claim payload parser)

1. Helper `apps/core/src/helpers/coworker-task-receipt.ts`:
   - `resolveTaskSellerReceipt(taskId, db, { signal })`: read the latest `TaskPaymentClaim` for the task (`where: { taskEvent: { taskId } }`), then `paymentClient().resolveMasumiTaskPaymentPurchase(parsePurchasePayload(claim.purchasePayload))` with a 20 s timeout combined with the request abort signal.
   - Return `{ blockchainIdentifier, claimStatus, onChainState, settled, txHash, withdrawnForSeller }`, where `settled` is `Withdrawn`, or `DisputedWithdrawn` with a non-empty `WithdrawnForSeller`.
   - No purchase on the node (`not_found`) returns `settled: false`, and so does a mismatch on a claim the sync already refunded. Any other node failure or terms mismatch throws 502, so an outage never reads as a proven non-payment. An unreadable stored payload returns 500.
   - Limitation: the pilot assumes one payment per task. If a task is re-charged (a second claim), only the newest claim is reported; an older settled claim would then read as `settled: false`.
2. Route `GET /v1/tasks/{id}/receipt` (`apps/core/src/routes/v1/tasks/[id]/receipt/get.ts`), coworker-readable via `requireTaskReadForRouteVars`, returns the helper output through a Zod/OpenAPI schema. Mount before `/{id}` dynamic routes.

### CLI (reads existing coworker client)

3. `runtime receipt --coworker-id ID TASK_ID`: `GET /v1/tasks/{id}/receipt`, print `{ onChainState, settled, txHash, withdrawnForSeller }` (`--json`), surface `txHash` for independent Preprod verification. `settled: false` is a valid result (exit 0); the agent branches on the field. `--organization-id` is not accepted.

No new MPS HTTP, no new settlement mapping, no CLI dependency on the private `@sokosumi/masumi` package (the published CLI stays standalone; the settlement read lives in Core).

## Acceptance criteria (SOK-1132)

- [x] The intended seller receipt is proven by `onChainState == "Withdrawn"` and the settlement `txHash`.
- [x] A `PURCHASED`/`FundsLocked`/`RefundWithdrawn` state or a mock receipt reads as `settled: false`.
- [x] The settlement `txHash` is surfaced for independent Preprod verification.

## Verified on Preprod

[VERIFIED, 2026-09-29] Against the live Preprod MPS node (`PAYMENT_API_URL`, `NETWORK=Preprod`) via `POST /api/v1/purchase/resolve-blockchain-identifier`:

- A real `Withdrawn` purchase → this change reports `settled: true` with the real settlement `txHash`.
- A real `RefundWithdrawn` purchase → `settled: false` (a refund is correctly not a seller receipt).
- `WithdrawnForSeller` came back **empty** on this node even for `Withdrawn` purchases, confirming `settled` must key off `onChainState`, not that array. The settlement `txHash` came from `CurrentTransaction.txHash`.

Correction (review, 2026-09-29): the reads above used the unchecked `getPurchaseByBlockchainIdentifier` lookup. The helper now uses `resolveMasumiTaskPaymentPurchase`, which calls the same node endpoint and adds the terms check. [NOT RE-VERIFIED on Preprod] with a real Task claim; only unit tests cover the new path.

## Follow-ups (from a masumi-cli / MPS cross-reference)

Deferred; not needed for the pilot, and none over-claims a receipt.

- **txHash source hardening.** `txHash` reads `CurrentTransaction.txHash`, which MPS documents as the *active* transaction and can be null after settlement. MPS itself reads the confirmed hash from `TransactionHistory`. A durable fix needs `@sokosumi/masumi` to request `includeHistory` on resolve, then pick the history entry whose `newOnChainState == "Withdrawn"`. Live Preprod reads returned a non-null `txHash`, so the happy path holds today.
- **Surface the paid amount.** For a plain `Withdrawn`, MPS reports the amount from `PaidFunds`/`RequestedFunds`, not `WithdrawnForSeller` (empty). The receipt proves `settled` but carries no amount in the common case; surface `PaidFunds` if the receipt should state how much the seller received.
- **Confirmed-tx gate (optional).** Gate `settled` on a confirmed on-chain transaction, as MPS does. The seller vkey and terms are already checked by `resolveMasumiTaskPaymentPurchase`.
- **Multi-claim.** See the helper limitation above (one payment per task assumed).

## References

SOK-1132, SOK-909, SOK-1180. masumi-cli has no seller-receipt equivalent; the authoritative "seller paid" definition lives in MPS (`billing.ts`, `payments/income`).
