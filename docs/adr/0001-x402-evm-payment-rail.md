# ADR 0001: x402/EVM payment rail as a sibling of Cardano escrow

- Status: Accepted
- Date: 2026-07-28 (proposed); 2026-08-11 (accepted)
- Deciders: sokosumi core team
- Technical story: follow-up phase to the Masumi payment-node V2 migration
  (PR #3440), which cut the sockets this rail plugs into.

> **Ratified 2026-08-11** via the x402/EVM wayfinder map
> (`docs/wayfinder/x402-evm/`). The refund-policy blocker below is resolved,
> and the payment-record model is settled as a sibling of PR 1's
> `TaskX402Payment`. The node behaviors the pinned spec did not guarantee are
> now **confirmed** against masumi-payment-service `main`
> (`docs/wayfinder/x402-evm/NODE-QUESTIONS.md` `## Answers`) and folded into
> the body below; nothing external gates the PR 2 build. The only node-side
> work still outstanding is the future settlement-observation surface, called
> out as explicitly-future below.

> **Amended 2026-08-28 by masumi ADR 0016.** The payment node removed
> `GET /x402/budgets` and the `x402.budget` rail check. The x402 spend cap now
> lives on the calling API key as per-unit usage credits
> (`eip155:<chainId>:<asset>`, gated by `usageLimited`), and wallet access is
> an `ApiKeyX402WalletScope` grant rather than a budget row. Decision 6
> (buy-side readiness gating) is restated below; the node-surface list in
> Context and the error-contract wording in Decision 4 are corrected in place.
> Every other decision here stands. Superseded sentences are named where they
> stood rather than deleted.

## Context

Sokosumi buys agent work through the Masumi payment node. Today every paid
job runs on the Cardano escrow rail (Web3CardanoV1/V2): funds lock in a smart
contract, the seller submits a result hash, and disputes/refunds resolve
on-chain. The payment node has since shipped an x402 rail: HTTP-402
pay-per-call on EVM chains, where the node signs an `X-PAYMENT` header and the
buyer replays the original request with it. The V2 registry already describes
x402 agents (`X402` manifests and `OpenApi` entries with EVM payment sources),
and sokosumi already ingests them. They appear on public `GET /v1/agents` as
`kind: "x402"` next to Cardano hire items (`kind: "cardano"`). There is no
`/v1/agents/x402`. Web `/agents` stays Coworkers-only (SOK-805); paying an
x402 agent stays coworker + assigned task.

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
  **Confirmed (ticket 011):** the pinned spec exposes a flat five-value
  `X402PaymentAttempt.status` (`PaymentRequired | Verified | Settled | Failed
  | Replayed`), but for an OUTBOUND attempt the lifecycle terminates at
  `Verified` | `Failed` — `Settled`/`Replayed` are inbound-only. Eventual
  settlement (agent → facilitator → chain) is observed post-hoc by a later
  reconciler (see the refund policy), never carried on this status.

Relevant payment-node surface (pinned in `packages/masumi/spec/payment.openapi.json`):

- `POST /x402/pay` — signs a payment for a forwarded 402
  (`evmWalletId`, `paymentRequired`, `preferredNetwork`, `preferredAsset`,
  `paymentIdentifier`).
- `GET /rail-readiness` — per-rail checks; the X402 rail's `isReady` covers
  *receiving* only. The coarse buy-side check is `x402.purchasing_wallet`.
  (Superseded: an `x402.budget` check sat beside it until masumi ADR 0016
  removed it.)
- `GET /api-key-status`: the calling key's own record, including
  `usageLimited` and its `RemainingUsageCredits` rows. This is where the x402
  spend cap lives after masumi ADR 0016.
- `/x402/networks`, `/x402/wallets`, `/x402/payments`: operator-level
  network and wallet management stays in the node. (Superseded:
  `/x402/budgets` sat in this list until masumi ADR 0016 removed it.)

Schema sockets already in place after the V2 migration:

- `AgentEntryType.X402`, `AgentEntryType.OPEN_API`,
  `Agent.x402ResourcesUrl`, and `Agent.openApiSpecUrl`.
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
  payment-identifier extension. **Confirmed (ticket 011):** it is a fail-loud
  correlation echo into the signed payload's extensions — the node 400s if the
  402 does not advertise the extension — never an independent dedup key.
- `caip2Network`, `asset`, `amount` (a digit `String` of chain-native base
  units), and `decimals` (from the **node-published** ready pair, never
  the agent row) — what was paid.
- Status mirrors the node's OUTBOUND attempt lifecycle: `PaymentRequired` →
  `Verified` | `Failed`, terminal at `Verified` once the payment is signed.
  There is no settle leg on this row — `Settled` belongs to the receiving
  node's inbound lifecycle and never arrives for our outbound attempts.
  (Terminal status confirmed — ticket 011; see Context above.) The persisted
  Soko enum is `PENDING | VERIFIED | FAILED | REFUNDED` — `PENDING` is the
  pre-sign row (the node's `PaymentRequired`), and `REFUNDED` is Soko's
  compensating-refund state (admin goodwill lever or the future
  `EXPIRED_UNUSED` reconciler), not a node status — matching the
  `TaskX402Payment` specified in PR1-SPEC §4 (not on `main` until the
  implementation PRs land). See also PR2-SPEC §2.

`JobX402Payment` (job-scoped, **PR 2**) and `TaskX402Payment` (task-scoped,
**PR 1** — the Bazaar coworker surface) are **two sibling tables, not one
shared row**. Both record an x402 payment leg with the same core columns
(`amount` is a digit `String` plus node-published `decimals`), but they hang
off different parents and carry different lifecycles (a job flow vs a
terminal coworker payment), exactly the JobPurchase-vs-escrow separation this
ADR already argues for. Shared behavior — amount→credits conversion, the
`/x402/pay` call, the verify-against-listed-source check, the CAIP-19 credit
keys — factors into a helper, not a table with a nullable parent. Neither
table is on `main` until those implementation PRs merge.

### 4. Job flow

1. Call the agent resource; expect `402 Payment Required`.
2. Normalize and narrow the 402 to one verified requirement. Forward that
   requirement to `POST /x402/pay` with Soko's configured `evmWalletId`.
3. Store the exact returned bearer header. Replay with its protocol-specific
   header name and value.
4. The response is the job result — persist it and complete the job in the
   same flow.

Timeouts and non-2xx replays leave the job failed with the payment attempt
recorded. `/x402/payments` lookups confirm what was signed and charged, but
NOT whether funds actually moved: the node's reconciler covers inbound
settlements only, and outbound attempts never advance past `Verified`. A
signed-then-failed replay is therefore not provably unpaid at replay time —
the agent holds a settleable header — so the debit stands, subject to the
post-hoc `EXPIRED_UNUSED` refund defined below.

**Confirmed (ticket 011):** the `/x402/pay` error contract is now known —
400 = deterministic pre-sign rejection (bad `accepts`, no `ChainIdLimit`
match, network disabled, requirements drift, identifier not advertised),
402 = usage-credit/balance refusal, and 500 = config/signing failure. Core
refunds only when one of these node-owned statuses also has the documented error
envelope. Transport failures, gateway statuses, malformed responses, and lost
responses remain ambiguous. `/x402/payments` still has no by-`attemptId`
filter and no `/x402/payments/{id}` route. Core therefore treats every ambiguous sign as
potentially live through a persisted `signRiskExpiresAt` fence; only after that
window may an operator resolve the held charge. Paginate-and-match remains
adequate for audit, so a direct node lookup is a low-priority nicety.

### 5. Credits pricing via CAIP-19-style unit keys

`CreditCost.unit` keys extend to CAIP-19-style ids for EVM assets
(`eip155:8453/erc20:0x…`). Cardano keys are unchanged. An x402 agent is
priceable only when every advertised amount's asset resolves to a configured
credit cost, exactly like the Cardano availability rule.

### 6. Buy-side readiness gating

Availability and pre-charge gates use Soko's cached set of ready
`(network, asset, evmWalletId, evmWalletAddress, decimals)` sources. A source
requires an enabled x402 network with a usable default-asset scale. Core also
requires a locally trusted exact-EVM EIP-712 domain for that pair. The Soko API
key's spend cap must allow the pair's unit, and some Purchasing wallet the key
can reach on that chain must hold positive native gas and a positive
default-token balance. The environment-global `x402.purchasing_wallet` rail
check remains a coarse diagnostic, not a listing or pre-charge gate. The cache
follows Cardano V2's last-known-value pattern.

**Amended 2026-08-28 (masumi ADR 0016).** The two sentences this decision used
to carry are superseded: "The Soko API key needs a positive budget tied to a
purchasing wallet" and "A confirmed admin key with no binding budget can
instead use exactly one Purchasing wallet". Both described a per-wallet budget
row that the node no longer has, and the `x402.budget` rail check named beside
them is gone too. What replaces them:

- The cap is on the KEY, not the wallet. `usageLimited` off means uncapped.
  On, the key needs remaining credit for unit `eip155:<chainId>:<asset>`,
  which is byte-identical to the pair key readiness composes on. The gate
  tests presence, not sufficiency: no price exists at sync time, so a nearly
  exhausted unit stays listed and the node refuses the charge with a 402.
- A `usageLimited` key holding no `eip155:` credit row at all is grandfathered
  uncapped by the node and really can pay, so it stays listed and the sync
  warns that the intended cap is not in force.
- Admin permission is no longer part of readiness. The node applies one wallet
  scope to both `GET /x402/wallets` and `POST /x402/pay`, so a wallet the
  listing returns is a wallet the key can sign with. Because the cap is
  key-global, nothing binds a chain to one wallet: the sync ranks the funded
  candidates and records the most-funded, tie-broken on wallet id so the
  cached set stays stable across syncs.

Two corrections to how the proposed draft described this (both verified
2026-08-11):

- The Cardano V2 pattern is **not** TTL'd. It serves the last recorded value
  and fails closed only in the never-recorded cold state
  (`apps/core/src/helpers/agent.ts` `getCardanoV2ReadySources`,
  `agent-sync.readiness.ts`). x402 readiness should follow the same shape,
  not a TTL.
- **Confirmed (ticket 011):** `/rail-readiness` exposes the x402 checks
  **once per environment, not per network** — there is no x402 analog of the
  Cardano `PurchaseSources` per-source readiness. Per-chain buy-side readiness
  is therefore **composed Soko-side** from `/x402/networks/available`, the
  calling key's spend caps on `/api-key-status`, `/x402/wallets`, and
  `/x402/wallets/balance`, reusing the same cached last-known-value pattern;
  the env-global `/rail-readiness` checks stay the coarse health signal. (The
  2026-08-11 wording read "Soko-key `/x402/budgets`, admin `/x402/wallets`";
  masumi ADR 0016 replaced the first with the key's usage credits and made the
  second reachable without admin.) Un-collapsing the per-chain breakdown
  `/rail-readiness` already computes is a low-priority node ask, not a build
  gate.

The trusted exact-EVM domain allowlist currently contains Base Sepolia USDC
(`USDC`, version `2`) and Base mainnet USDC (`USD Coin`, version `2`). The
resource server cannot override this signing domain.

### 7. Node prerequisites (operator runbook, not code)

- X402Network enabled on the node per target chain.
- A funded Purchasing EVM wallet per chain that the sokosumi API key can
  reach, holding both native gas and the chain's priced token.
- The sokosumi API key's `ChainIdLimit` includes the relevant `eip155:*` ids.
- When that key is `usageLimited`, credits for unit
  `eip155:<chainId>:<asset>` on each target chain, granted with
  `PATCH /api/v1/api-key` (masumi ADR 0016).

### 8. One public `GET /v1/agents`

x402 agents are agents. They share the public Cardano catalog:

- `GET /v1/agents` returns a discriminated union on `kind`: `"cardano"`
  (MIP-003 hire) or `"x402"` (EVM pay). Filter with `?kind=cardano`,
  `?kind=x402`, or omit for both.
- There is **no** `/v1/agents/x402`.
- List auth is **public**, same as today's Cardano catalog.
- **Pay** stays coworker + assigned task
  (`POST /v1/tasks/{id}/x402-payments`). Listed ⇒ payable, fail-closed,
  scheme `exact`.
- Web `/agents` does **not** advertise x402 (or classic hire agents).
  SOK-805: that page is Coworkers-only. x402, like classic agents, is
  API-only.

A dedicated coworker-only `/v1/agents/x402` was sketched and dropped
during implementation. This ADR records the shipped contract.

## Credit-refund policy (resolved 2026-08-11)

The proposed draft left this as the blocking product decision. Resolved via
the wayfinder map (ticket 006), stated per settlement layer — x402 direct
settlement has no clawback by construction, Disputable (Masumi) escrow does,
and by registry design an agent offers exactly one, so the two never compete
on a single job:

- **PR 2 (masumi jobs on x402): auto-refund only when provably unpaid.**
  Credits return synchronously only when the node's documented refusal status
  and error envelope prove signing never happened. Transport failures,
  gateway statuses, malformed 200s, and lost responses remain ambiguous and
  held because a header may have been signed. Once a usable header is delivered
  for replay, the debit stands: a settled payment, a garbage result, or a
  non-2xx / timed-out **replay** leaves the agent holding a settleable header.
  A signed-but-unused authorization becomes provably unpaid only after the
  expiry observation below. There is
  deliberately **no parity** with escrow-job refunds — escrow can claw back,
  x402 cannot, and Soko does not absorb a settled loss silently.
- **`EXPIRED_UNUSED` (phased settlement observation — explicitly future
  work).** The one narrow exception to "signed ⇒ debit stands": an EIP-3009
  authorization Soko signed but that **expired without ever being consumed**
  on-chain is provably unpaid after its `validBefore`. Records store the
  authorization fields (`from` / nonce / `validBefore` / payload hash) now; a
  later settlement-observation reconciler checks `authorizationState` past
  expiry — consumed → settled-observed, debit stands; **expired unused →
  `EXPIRED_UNUSED` → post-hoc auto-refund**. This is distinct from an
  unresolved in-flight timeout, which stays ambiguous (debit stands) until
  expiry resolves it, and from a signed-and-used authorization, which is never
  refunded. Consistent with PR2-SPEC §5; the reconciler and the node-side
  outbound settlement-observation surface it depends on are not yet built and
  do not gate the initial ship.
- **PR 1 (Bazaar coworker payments): auto-refund only when unsettleable.**
  Soko has no visibility into the externally-fetched result. Credits return
  synchronously only when no header was ever written to the row — a
  documented node refusal on the **fresh first** sign attempt. After a
  header exists on the row (or was returned to the coworker), the debit
  stands: garbage results, unused replay, and crash-after-delivery are
  admin / future `EXPIRED_UNUSED`, not a sync refund. Persist `VERIFIED`
  **before** returning the header. An **admin refund / resolve lever** plus
  **per-agent refund/failure aggregation** feeds a **whitelist-disable**
  for bleeding endpoints. Full state machine: PR1-SPEC §3.
- **Absorbed loss is bounded operationally**, not by refund policy: the
  per-agent aggregation + whitelist-disable is the control that stops a
  bad agent from bleeding credits, on both rails.

## Alternatives considered

- **Model x402 payments as `JobPurchase` rows with a type column.** Rejected:
  the escrow state machine (locking deadlines, result hashes, refund states)
  is meaningless for x402, and every consumer of purchase state would need
  rail-specific branches anyway. A sibling model keeps both lifecycles honest.
- **Integrate an x402 facilitator/wallet directly in sokosumi.** Rejected:
  custody of EVM keys moves into sokosumi, duplicates the node's wallet,
  spend-cap, and settlement machinery, and diverges from the payment-node
  delegation model the Cardano rails use.
- **Infer the rail from the agent's entry type at runtime.** Rejected: jobs
  outlive agent revisions (agents are re-registered and superseded), so the
  rail must be pinned on the job at creation, consistent with the V2
  migration's snapshot-on-job pattern.
- **Dedicated coworker-only `GET /v1/agents/x402`.** Rejected: callers see
  one agent catalog. A `kind` discriminator on `GET /v1/agents` is enough.
  Pay stays a separate coworker+task route. Web `/agents` is not a catalog.

## Consequences

- **Ingest** already lands x402 payment sources. Discovery is public
  `GET /v1/agents` (`kind: "x402"`), not a dedicated `/v1/agents/x402`.
  Web `/agents` stays Coworkers-only. Flipping Cardano-catalog hire
  availability for x402 jobs is PR 2, not ingest.
- The jobs pipeline gains one discriminator and one sibling model; escrow
  code paths remain untouched.
- Status tooling uses `/x402/payments` lookups to confirm signing/charging
  only, never settlement (outbound attempts have no reconcilable settle
  state). The pinned spec offers no by-`attemptId` filter, but that is a
  low-priority nicety, not a correctness gap — paginate-and-match suffices
  (ticket 011).
- The credit-refund product decision is **resolved** (above), and the
  ticket-011 node confirmations have landed (`NODE-QUESTIONS.md` `## Answers`)
  — nothing external gates the build. Engineering can proceed to the PR 2 spec
  and implementation; the only remaining node-side work is the future
  settlement-observation surface, which does not gate the initial ship.
- PR 1 (the Bazaar coworker surface, `docs/wayfinder/x402-evm/PR1-SPEC.md`)
  ships first and independently — it shares the CAIP-19 credit keys, the
  `/x402/pay` delegation, and the refund policy with this rail, but no job
  pipeline. PR 2 builds on the discriminator and sibling model here.
