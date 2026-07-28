# ADR 0001: x402/EVM payment rail as a sibling of Cardano escrow

- Status: Proposed
- Date: 2026-07-28
- Deciders: sokosumi core team
- Technical story: follow-up phase to the Masumi payment-node V2 migration
  (PR #3440), which cut the sockets this rail plugs into.

## Context

Sokosumi buys agent work through the Masumi payment node. Today every paid
job runs on the Cardano escrow rail (Web3CardanoV1/V2): funds lock in a smart
contract, the seller submits a result hash, and disputes/refunds resolve
on-chain. The payment node has since shipped an x402 rail: HTTP-402
pay-per-call on EVM chains, where the node signs an `X-PAYMENT` header and the
buyer replays the original request with it. The V2 registry already describes
x402 agents (entry type `X402`, `x402ResourcesUrl`, EVM payment sources), and
sokosumi already ingests them as unavailable-by-type.

The two rails differ structurally, not just by network:

- **Escrow** is asynchronous and stateful: a purchase row advances through
  FundsLocked → ResultSubmitted → Withdrawn (or refund states), and the buyer
  can recover funds when a seller never delivers.
- **x402** is synchronous and terminal: call the resource, receive a 402 with
  payment requirements, have the node sign a payment, replay the call, and
  the HTTP response *is* the result. Settlement finishes at `Verified`; there
  is no escrow, no result hash, and no on-chain refund path.

Relevant payment-node surface (pinned in `packages/masumi/spec/payment.openapi.json`):

- `POST /x402/pay` — signs a payment for a forwarded 402
  (`evmWalletId`, `paymentRequired`, `preferredNetwork`, `preferredAsset`,
  `paymentIdentifier`).
- `GET /rail-readiness` — per-rail checks; the X402 rail's `isReady` covers
  *receiving* only, while buy-side readiness is expressed by the
  `x402.purchasing_wallet` and `x402.budget` checks.
- `/x402/networks`, `/x402/wallets`, `/x402/budgets`, `/x402/payments` —
  operator-level network/wallet/budget management stays in the node.

Schema sockets already in place after the V2 migration:

- `AgentEntryType.X402` and `Agent.x402ResourcesUrl`.
- `AgentPaymentSource.network` is a plain string that carries either a
  Cardano network name or a CAIP-2 id (`eip155:8453`), with `payTo`,
  `scheme`, and `resource` columns.
- `AgentPaymentSourceAmount.unit` carries a chain-native asset identifier
  (Cardano unit or ERC-20 address) with optional `decimals`.

## Decision

### 1. x402 is a new rail, not a MIP-003 variant

The x402 job flow bypasses the MIP-003 start-job/status polling protocol
entirely. We will not shoehorn it into the existing purchase pipeline:
no `JobPurchase` row, no purchase-state polling, no submit-result deadline
bookkeeping.

### 2. `paymentRail` discriminator on Job

`Job` gains a `paymentRail` enum: `CARDANO_ESCROW` (default, backfilled for
all existing rows) `| X402`. Rail-specific logic branches on this field
instead of inferring the rail from identifier shapes or agent entry types.

### 3. `JobX402Payment` as a sibling of `JobPurchase`

A dedicated model records the payment leg of an x402 job:

- `attemptId` — the node's payment-attempt id, our join key for
  reconciliation against `/x402/payments`.
- `paymentPayloadHash` — hash of the signed payment payload we replayed.
- `paymentIdentifier` — present when the 402 advertises the Masumi
  payment-identifier extension.
- `caip2Network`, `asset`, `amount` (BigInt), `decimals` — what was paid,
  denominated chain-natively.
- Status mirrors the node's attempt lifecycle and terminates at `Verified`;
  a settle failure after verification keeps the row `Verified` with the error
  recorded (the node never auto-fails a verified single-use payment).

### 4. Job flow

1. Call the agent resource; expect `402 Payment Required`.
2. Forward the 402 body to the node: `POST /x402/pay` with the configured
   `evmWalletId` and, when the 402 advertises it, the `paymentIdentifier`.
3. Replay the original request with the returned `X-PAYMENT` header.
4. The response is the job result — persist it and complete the job in the
   same flow.

Timeouts and non-2xx replays leave the job failed with the payment attempt
recorded; reconciliation against `/x402/payments` by `attemptId` resolves
ambiguous outcomes.

### 5. Credits pricing via CAIP-19-style unit keys

`CreditCost.unit` keys extend to CAIP-19-style ids for EVM assets
(`eip155:8453/erc20:0x…`). Cardano keys are unchanged. An x402 agent is
priceable only when every advertised amount's asset resolves to a configured
credit cost, exactly like the Cardano availability rule.

### 6. Buy-side readiness gating

Availability and pre-charge gates for x402 agents key on the node's
`x402.purchasing_wallet` and `x402.budget` rail-readiness checks — not on
the X402 rail's `isReady`, which only proves the node can *receive* x402
payments. The same cached, TTL'd fail-closed pattern used for Cardano V2
readiness applies, extended per EVM network.

### 7. Node prerequisites (operator runbook, not code)

- X402Network enabled on the node per target chain.
- A funded purchasing EVM wallet per chain, bound to the network.
- The sokosumi API key's `ChainIdLimit` includes the relevant `eip155:*` ids.

## Open product decision (blocking rollout, not design)

**Credit-refund policy for failed x402 jobs.** With escrow, a
never-delivered job ends in an on-chain refund. With x402 the node cannot
claw back a settled payment: if the seller takes payment and returns garbage,
sokosumi has spent real funds. Whether users are made whole in credits (and
who absorbs the loss) is a product decision that must be made before the rail
is user-visible. The design above records everything needed to implement
either answer.

## Alternatives considered

- **Model x402 payments as `JobPurchase` rows with a type column.** Rejected:
  the escrow state machine (locking deadlines, result hashes, refund states)
  is meaningless for x402, and every consumer of purchase state would need
  rail-specific branches anyway. A sibling model keeps both lifecycles honest.
- **Integrate an x402 facilitator/wallet directly in sokosumi.** Rejected:
  custody of EVM keys moves into sokosumi, duplicates the node's wallet,
  budget, and settlement machinery, and diverges from the payment-node
  delegation model the Cardano rails use.
- **Infer the rail from the agent's entry type at runtime.** Rejected: jobs
  outlive agent revisions (agents are re-registered and superseded), so the
  rail must be pinned on the job at creation, consistent with the V2
  migration's snapshot-on-job pattern.

## Consequences

- Discovery needs no further work: x402 agents already ingest with their EVM
  payment sources; flipping availability is gated on this rail shipping.
- The jobs pipeline gains one discriminator and one sibling model; escrow
  code paths remain untouched.
- Reconciliation tooling must learn `/x402/payments` lookups by `attemptId`.
- The credit-refund product decision is the rollout gate; engineering can
  proceed to implementation behind a flag without it.
