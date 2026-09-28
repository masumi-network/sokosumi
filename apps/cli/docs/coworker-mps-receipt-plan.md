# Coworker MPS Seller Receipt (SOK-1132)

Draft. Goal: complete one authorized Task through the Masumi Payment Service (MPS) and prove the intended developer wallet receipt on Cardano Preprod. A `PURCHASED` state or mock receipt does not count.

## Findings from the MPS code

[REPORTED: read of `masumi-payment-service` and `sokosumi/packages/masumi`, 2026-09-29]

- **Seller receipt = `onChainState == "Withdrawn"` with a populated `WithdrawnForSeller[]`.** This is reached only after the escrow contract pays the seller on-chain, distinct from `FundsLocked` (buyer debit). Enum: `masumi-payment-service/prisma/schema.prisma` `OnChainState`. Fields: `src/routes/api/purchases/schemas.ts` (`onChainState`, `WithdrawnForSeller`).
- **Read it via** `GET /api/v1/purchase` (or `GET /api/v1/payment`). Auth header is `token` (raw API key). Confirm the settlement transaction with `CurrentTransaction.txHash` whose `newOnChainState == Withdrawn` (verifiable on a Preprod explorer or Blockfrost).
- **State order**: buyer debit `FundsLocked` -> seller `ResultSubmitted` -> `WithdrawAuthorized` -> `Withdrawn` (+ `WithdrawnForSeller`).
- **Guards are server-side**: MPS rejects an unapproved price, a different payer, and tampered terms (signature-bound `blockchainIdentifier`), and blocks a duplicate debit via a unique `blockchainIdentifier`. The client only surfaces the 400/409 responses; it does not re-implement these checks.
- **Existing client**: `sokosumi/packages/masumi/src/clients/masumi-payment.client.ts` already models the purchase query, network selection, 409 idempotency, and a seller-vkey match (`doesResolvedPurchaseSellerMatch`).

## Why Core cannot prove this today

[VERIFIED: `sokosumi/packages/database/prisma/schema.prisma:3142`] Core's `TaskPaymentClaimStatus` is only `PENDING | PURCHASED | REFUNDED`. The schema comment states Soko "cannot observe settlement" until a phased-settlement reconciler ships. So Core's terminal paid state is `PURCHASED` (buyer debit), which SOK-1132 calls insufficient. The `Withdrawn` seller receipt is not tracked by Core.

Consequence: the CLI cannot read the seller receipt from Core. It must observe settlement directly.

## Current CLI surface

[VERIFIED: `apps/cli/src/cli/commands/runtime.ts`, `apps/cli/src/coworker/runtime-task.ts:374`] `runtime pay` submits a Task event with the seller `masumiPayment` and confirms acceptance (a Core event with `transactionId` and credits). Its own output says "Seller receipt is not yet verified." That is the gap.

## Design decision (needs a call)

To prove the seller receipt, the CLI must observe settlement outside Core. Two options:

- **Option A: query MPS directly.** Add a CLI command that reads `GET /api/v1/purchase` for the claim's `blockchainIdentifier`, polls until `onChainState == Withdrawn`, and reports `WithdrawnForSeller` + the settlement `txHash`. Needs the MPS base URL, a read-scoped `token`, and the `blockchainIdentifier` (available from the paid claim).
- **Option B: verify on-chain.** Use the settlement `txHash` (or the `blockchainIdentifier`) and confirm the payout to the seller address on Preprod via Blockfrost. Heaviest, no MPS token needed, strongest proof.

Recommendation: Option A, with the settlement `txHash` printed so it is independently checkable on Preprod (a light touch of Option B).

## Proposed CLI change (Option A)

- New `runtime receipt --coworker-id ID --organization-id ID` (or `--blockchain-identifier ID`) that reads the settlement and asserts `Withdrawn`.
- `--json` output: `{ onChainState, withdrawnForSeller, txHash, settled: true|false }`.
- Exit non-zero (using the new error/exit-code table) when not yet settled.

## Acceptance criteria (SOK-1132)

- [ ] Proof includes customer debit, delivered result, and intended seller receipt (`Withdrawn` + `WithdrawnForSeller`).
- [ ] A `PURCHASED`/`FundsLocked` state or a mock receipt is rejected as insufficient.
- [ ] The settlement `txHash` is surfaced for independent Preprod verification.

## Open items before implementation

1. Confirm Option A vs B.
2. Confirm the MPS base URL and read-token source for the CLI (config or env).
3. Confirm the CLI may take a dependency on `packages/masumi` or should call MPS over plain HTTP.

## References

SOK-1132, SOK-909, SOK-1180.
