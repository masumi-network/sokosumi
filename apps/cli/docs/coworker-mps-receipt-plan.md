# Coworker MPS Seller Receipt (SOK-1132)

Goal: prove the intended developer wallet receipt for a Coworker Task on Cardano Preprod. A `PURCHASED`/`FundsLocked` state or a mock receipt does not count; the proof is `onChainState == "Withdrawn"` plus the settlement transaction hash. `WithdrawnForSeller` is best-effort node metadata and can be empty even for a settled purchase (see Verified on Preprod), so `settled` keys off `onChainState` alone.

## Why this reuses existing infra

[VERIFIED: code read, 2026-09-29]

- **Jobs already prove settlement.** `apps/core/src/services/job-sync.service.ts:248` calls `transformPurchaseToJobUpdate` (`apps/core/src/helpers/purchase.ts`), which maps MPS `onChainState` (including `Withdrawn`) using `paymentClient().resolvePurchase(blockchainIdentifier)` (`apps/core/src/clients/masumi-payment.client.ts`, a wrapper over `@sokosumi/masumi` `createPaymentClient`, reading `PAYMENT_API_URL` / `PAYMENT_API_KEY`).
- **Coworker Tasks do not.** They only have `TaskPaymentClaim` (`PENDING | PURCHASED | REFUNDED`, `packages/database/prisma/schema.prisma:3142`). Core "cannot observe settlement" for them yet.
- `paymentClient().resolvePurchase(id)` returns `Result<ResolvedPurchase, string>` (neverthrow). `ResolvedPurchase` is the full node row: `onChainState`, `WithdrawnForSeller[]`, `CurrentTransaction.txHash`.
- `doesResolvedPurchaseSellerMatch` (`@sokosumi/masumi`) confirms the payout seller vkey.

So the minimal change resolves the Task claim's purchase on demand through the same client and mapping the Job flow already uses.

## Change

### Core (reuses `paymentClient` + `purchase.ts`)

1. Helper `apps/core/src/helpers/coworker-task-receipt.ts`:
   - `resolveTaskSellerReceipt(taskId, db)`: read the latest `TaskPaymentClaim` for the task (`where: { taskEvent: { taskId } }`), then `paymentClient().getPurchaseByBlockchainIdentifier(claim.blockchainIdentifier)`.
   - Return `{ blockchainIdentifier, claimStatus, onChainState, settled: onChainState === "Withdrawn", txHash, withdrawnForSeller }`.
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

## References

SOK-1132, SOK-909, SOK-1180.
