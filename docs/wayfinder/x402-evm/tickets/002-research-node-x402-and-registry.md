---
title: What the payment node and registry already give us for x402
type: research
status: closed
claimed: research-agent
blocked-by: []
---

## Question

How much of PR 1 is already buildable against surfaces we have — the pinned
payment-node spec and what Soko currently ingests from the registry?

Resolve from in-repo sources (`packages/masumi/spec/payment.openapi.json`,
`packages/masumi/spec/registry.openapi.json`, the V2 ingestion code):

1. The full `POST /x402/pay` contract: request (`evmWalletId`,
   `paymentRequired`, `preferredNetwork`, `preferredAsset`,
   `paymentIdentifier`), response (the signed header? an attempt id?), error
   modes, and idempotency behavior. What is ambiguous vs guaranteed?
2. Wallet/budget/network surfaces (`/x402/wallets`, `/x402/budgets`,
   `/x402/networks`, `/x402/payments`) — enough to say what operator setup
   PR 1 requires and what Soko can query after a payment.
3. Rail readiness for buy-side x402: which checks
   (`x402.purchasing_wallet`, `x402.budget`) exist in the pinned spec, per
   network or global, and how they map onto the Cardano-V2 readiness pattern
   Soko already has.
4. What the registry serves for X402 entries today and what Soko stores:
   entry shape, `x402ResourcesUrl`, payment sources with CAIP-2 network +
   ERC-20 asset + decimals. Are Bazaar-sourced agents present at all, or is
   registry indexing of Bazaar an unshipped external dependency? Name the
   gap precisely if so.

Findings go to `../research/002-node-x402-registry.md`; feeds every PR 1
ticket and the ADR ratification.

## Resolution

Full findings: [`../research/002-node-x402-registry.md`](../research/002-node-x402-registry.md).

1. `POST /x402/pay` is fully specced for the happy path (required
   `evmWalletId` + `paymentRequired`; optional `preferredNetwork`,
   `preferredAsset`, undescribed `paymentIdentifier`; response returns
   `attemptId` + `xPaymentHeader` + signed tuple) — but declares NO error
   responses and NO idempotency; retries must be assumed to double-charge.
2. Operator surfaces all exist: `/x402/networks(+/available)`, `/x402/wallets`
   (Purchasing/Selling, key returned once), `/x402/budgets` (per
   apiKey+wallet+chain+asset, base units), `/x402/payments` — list-only, no
   by-`attemptId` lookup (ADR 0001 assumes one; drift).
3. `x402.purchasing_wallet` and `x402.budget` checks exist on
   `/rail-readiness` but are non-blocking and environment-global, not
   per-network; Soko's readiness plumbing reuses cleanly, per-chain gating
   needs endpoint composition or node work.
4. Registry spec fully describes X402 entries (type, `x402ResourcesUrl`,
   CAIP-2/ERC-20/decimals sources) and Soko already persists everything,
   excluded from the catalog by `type: STANDARD`. Bazaar is not expressible
   in the pinned registry spec (Cardano policy sources only) — whether the
   deployed registry indexes Bazaar is an external unknown for the registry
   team.
