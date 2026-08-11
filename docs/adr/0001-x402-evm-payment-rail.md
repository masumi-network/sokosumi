# ADR 0001: x402/EVM payment rail as a sibling of Cardano escrow

- Status: Accepted
- Date: 2026-07-28 (proposed); 2026-08-11 (accepted)
- Deciders: sokosumi core team
- Technical story: follow-up phase to the Masumi payment-node V2 migration
  (PR #3440), which cut the sockets this rail plugs into.

> **Ratified 2026-08-11** via the x402/EVM wayfinder map
> (`docs/wayfinder/x402-evm/`). The refund-policy blocker below is resolved,
> and the payment-record model is settled as a sibling of PR 1's
> `TaskX402Payment`. Node behaviors the pinned spec does not guarantee are
> marked **[pending node confirmation — wayfinder ticket 011]** inline; they
> gate the PR 2 build, not this decision.

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
  the HTTP response *is* the result. The buyer node's OUTBOUND attempt
  lifecycle terminates at `Verified` (or `Failed`) once the payment is
  signed; settlement to `Settled` is the receiving side's concern. There is
  no escrow, no result hash, and no on-chain refund path.
  **[pending node confirmation — ticket 011]** The pinned spec exposes a flat
  five-value `X402PaymentAttempt.status` (`PaymentRequired | Verified |
  Settled | Failed | Replayed`) with no direction-scoped lifecycle and no
  status on the `/x402/pay` response; terminal-at-`Verified` is the design
  intent, to be confirmed before code hardcodes it.

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

- `attemptId` — the node's payment-attempt id, our join key against
  `/x402/payments`.
- `paymentPayloadHash` — hash of the signed payment payload we replayed.
- `paymentIdentifier` — present when the 402 advertises the Masumi
  payment-identifier extension. **[pending node confirmation — ticket 011]**
  The `/x402/pay` `paymentIdentifier` request field is undocumented in the
  pin; that it echoes the 402's Masumi extension (rather than being an
  independent correlation/dedup id) is an assumption to confirm.
- `caip2Network`, `asset`, `amount` (BigInt), `decimals` — what was paid,
  denominated chain-natively.
- Status mirrors the node's OUTBOUND attempt lifecycle: `PaymentRequired` →
  `Verified` | `Failed`, terminal at `Verified` once the payment is signed.
  There is no settle leg on this row — `Settled` belongs to the receiving
  node's inbound lifecycle and never arrives for our outbound attempts.
  (Same terminal-status caveat as Context above — ticket 011.)

`JobX402Payment` (job-scoped, this PR) and `TaskX402Payment` (task-scoped,
PR 1 — the Bazaar coworker surface) are **two sibling tables, not one shared
row**. Both record an x402 payment leg with the same core columns, but they
hang off different parents and carry different lifecycles (a job flow vs a
terminal coworker payment), exactly the JobPurchase-vs-escrow separation this
ADR already argues for. Shared behavior — amount→credits conversion, the
`/x402/pay` call, the verify-against-listed-source check, the CAIP-19 credit
keys — factors into a helper, not a table with a nullable parent.

### 4. Job flow

1. Call the agent resource; expect `402 Payment Required`.
2. Forward the 402 body to the node: `POST /x402/pay` with the configured
   `evmWalletId` and, when the 402 advertises it, the `paymentIdentifier`.
3. Replay the original request with the returned `X-PAYMENT` header.
4. The response is the job result — persist it and complete the job in the
   same flow.

Timeouts and non-2xx replays leave the job failed with the payment attempt
recorded. `/x402/payments` lookups by `attemptId` can confirm what was
signed and charged, but NOT whether funds actually moved: the node's
reconciler covers inbound settlements only, and outbound attempts never
advance past `Verified`. A timed-out replay therefore stays genuinely
ambiguous — the failure-handling and credit-refund policy must assume the
payment may have been taken.
**[pending node confirmation — ticket 011]** `/x402/payments` as pinned has
no by-`attemptId` filter and no `/x402/payments/{id}` route — only paginated
list filters (`status`, `direction`, `side`, `caip2Network`, …). Confirming a
specific attempt today means paginating and matching client-side; the
reconciler needs either an id lookup added or that workaround. The
`/x402/pay` operation also declares **no non-200 responses**, so node-side
failures (budget exhausted, wallet missing, no acceptable `accepts`) have no
documented shape to branch on — needed before Soko can classify them.

### 5. Credits pricing via CAIP-19-style unit keys

`CreditCost.unit` keys extend to CAIP-19-style ids for EVM assets
(`eip155:8453/erc20:0x…`). Cardano keys are unchanged. An x402 agent is
priceable only when every advertised amount's asset resolves to a configured
credit cost, exactly like the Cardano availability rule.

### 6. Buy-side readiness gating

Availability and pre-charge gates for x402 agents key on the node's
`x402.purchasing_wallet` and `x402.budget` rail-readiness checks — not on
the X402 rail's `isReady`, which only proves the node can *receive* x402
payments. Reuse the same cached readiness pattern Soko already runs for
Cardano V2.

Two corrections to how the proposed draft described this (both verified
2026-08-11):

- The Cardano V2 pattern is **not** TTL'd. It serves the last recorded value
  and fails closed only in the never-recorded cold state
  (`apps/core/src/helpers/agent.ts` `getCardanoV2ReadySources`,
  `agent-sync.readiness.ts`). x402 readiness should follow the same shape,
  not a TTL.
- **[pending node confirmation — ticket 011]** `/rail-readiness` exposes the
  x402 checks **once per environment, not per network** — there is no x402
  analog of the Cardano `PurchaseSources` per-source readiness. "Extended per
  EVM network" is therefore not buildable from the endpoint as pinned;
  per-chain gating needs endpoint composition or node work. Until then,
  x402 buy-side readiness is an environment-global gate.

### 7. Node prerequisites (operator runbook, not code)

- X402Network enabled on the node per target chain.
- A funded purchasing EVM wallet per chain, bound to the network.
- The sokosumi API key's `ChainIdLimit` includes the relevant `eip155:*` ids.

## Credit-refund policy (resolved 2026-08-11)

The proposed draft left this as the blocking product decision. Resolved via
the wayfinder map (ticket 006), stated per settlement layer — x402 direct
settlement has no clawback by construction, Disputable (Masumi) escrow does,
and by registry design an agent offers exactly one, so the two never compete
on a single job:

- **PR 2 (masumi jobs on x402): auto-refund only when provably unpaid.**
  Credits return automatically only where Soko provably never put funds at
  risk — the payment was never signed, or the replay was never sent.
  Everything after signing (settled, garbage result, non-2xx, timeout) keeps
  the debit. The ambiguous timed-out replay above is answered by
  construction: signed-but-timed-out is **not** provably unpaid, so no
  auto-refund. There is deliberately **no parity** with escrow-job refunds —
  escrow can claw back, x402 cannot, and Soko does not absorb a settled loss
  silently.
- **PR 1 (Bazaar coworker payments): no auto-refund** — credits spent are
  spent; Soko has no visibility into the externally-fetched result. Two
  levers ship instead: an admin refund action on the payment record
  (goodwill, support-driven), and per-endpoint refund/failure aggregation in
  the admin dashboard that feeds a **whitelist-disable** lever for bleeding
  endpoints.
- **Absorbed loss is bounded operationally**, not by refund policy: the
  per-endpoint aggregation + whitelist-disable is the control that stops a
  bad agent from bleeding credits, on both rails.

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
- Status tooling must learn `/x402/payments` lookups by `attemptId` —
  understanding they confirm signing/charging only, never settlement
  (outbound attempts have no reconcilable settle state), and that the pinned
  spec offers no id filter yet (ticket 011).
- The credit-refund product decision is **resolved** (above); the rollout
  gate is now the ticket-011 node confirmations. Engineering can proceed to
  the PR 2 spec and implementation behind a flag; the marked items must be
  confirmed before ship.
- PR 1 (the Bazaar coworker surface, `docs/wayfinder/x402-evm/PR1-SPEC.md`)
  ships first and independently — it shares the CAIP-19 credit keys, the
  `/x402/pay` delegation, and the refund policy with this rail, but no job
  pipeline. PR 2 builds on the discriminator and sibling model here.
