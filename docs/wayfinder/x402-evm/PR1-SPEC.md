# PR 1 spec — Bazaar coworker x402 payment surface

> **Status:** approved (ticket 007) and **upgraded by the ticket-011 answers**
> — all seven node questions resolved from upstream `main` source
> ([NODE-QUESTIONS.md](NODE-QUESTIONS.md) `## Answers`); nothing external
> gates the build, and the deployed nodes already run the x402 surface. Every decision here traces to a closed ticket — links inline.
> Substrate: [ADR 0001](../../adr/0001-x402-evm-payment-rail.md).

## 1. Scope

API-only pay. Anyone can **list** x402/Bazaar agents on public
`GET /v1/agents`. A coworker assigned to a task can **pay** a 402 one of
them returned, charged to the task's org in credits, receiving a signed
`X-PAYMENT` header to replay with. No end-user catalog change, no hire
flow, no job row — the coworker calls the agent **outside** Soko. Web
`/agents` stays Coworkers-only (SOK-805).

Out of scope: masumi-job x402 (PR 2), direct CDP-Bazaar crawling (agents must
be Masumi-registered), end-user hireability.

The full loop (Patrick's four steps):

```
anyone   → GET  /v1/agents?kind=x402                (list; pick base URL)
coworker → call the Bazaar agent directly           (outside Soko) → 402
coworker → POST /v1/tasks/{taskId}/x402-payments     (forward the 402)
   soko  → charge task org in credits, POST node /x402/pay, persist record
coworker ← { xPaymentHeader, attemptId, paymentId }
coworker → replay the agent call with X-PAYMENT      (outside Soko) → result
```

There is **no** `GET /v1/agents/x402`. Pay stays coworker + assigned task.

## 2. Listing endpoint — `GET /v1/agents`

Ticket 005. One public catalog. Items are a discriminated union on `kind`:
`"cardano"` (MIP-003 hire) or `"x402"` (EVM pay). Filter with
`?kind=cardano`, `?kind=x402`, or omit for both.
`buildAvailableAgentWhereClause` still excludes x402 rows from the cardano
branch.

- **Authz:** public, same as the Cardano catalog. Paying stays coworker-only
  on the task route.
- **Fail closed** — an agent appears only if payable *now*:
  1. curated/whitelisted (production; preprod lists all — see §6),
  2. every advertised source uses scheme `exact` (EVM). `upto`,
     `batch-settlement`, and any other scheme never appear in `accepts[]`
     and never list (research 001 saw those in the wild; Soko only signs
     `exact`),
  3. every advertised asset resolves to a `CreditCost` row,
  4. its network is in the per-environment EVM allowlist (preprod = testnet
     CAIP-2 ids only),
  5. x402 buy-side readiness OK (§6).
- **`PricingType` on `main` is `FIXED | FREE | UNKNOWN`.** This stack adds
  `DYNAMIC` and stops mapping registry Dynamic → `UNKNOWN`. x402 Dynamic
  entries list with `pricingType: "dynamic"`; `isPayable` is true when
  every advertised network has a priced buy-side-ready asset, otherwise
  they stay visible as non-payable previews. The Dynamic/`maxCredits` pay
  gate **runs** on this stack.
- **Response fields per agent:** id, name, description, image (all resolved
  through the existing `AgentMetadataOverride`-aware helpers — X402 agents
  carry the standard override fields so a later read-only UI needs no
  rework), `x402ResourcesUrl`, and the payment sources (CAIP-2 network,
  asset, decimals, `payTo`, advertised price in both native units and
  converted credits).
- Listed ⇒ payable gives per-endpoint refund aggregation (§5) a stable
  population to count against.
- **Fail-closed granularity is per-AGENT, ratified at build review** (stack
  step 4): one unpriced asset, disallowed network, or unready pair hides the
  whole agent, per the universal reading of "every advertised asset". Known
  consequence, accepted: an agent registering both a mainnet and a testnet
  source is unlistable in both environments until re-registered — the safe
  direction, and out-of-env assets rarely carry CreditCost rows anyway. If
  mixed-env registrations turn out to be common, the follow-up is an env
  scoping PRE-filter (drop out-of-env sources, then per-agent fail-closed
  over the remainder), not per-source listing.

## 3. Pay endpoint — `POST /v1/tasks/{taskId}/x402-payments`

Ticket 003. A thin, **verified** proxy of the node's `POST /x402/pay`.

### Request

Modeled on the node's own request so translation is minimal:

```jsonc
{
  "idempotencyKey": "coworker-supplied, unique per intent",   // required
  "agentId": "the listed agent this 402 came from",           // required
  "paymentRequired": { /* the raw 402 body, verbatim, either dialect */ },
  "maxCredits": 2 // optional per-request ceiling; required for Dynamic
}
```

- `evmWalletId` is **never** caller-supplied — Soko owns the purchasing
  wallet per environment/network.
- Task identity (taskId, the created event id) is stamped into the node
  call's `paymentIdentifier` — **only when the agent's 402 advertises the
  payment-identifier extension** (the node 400s otherwise; ticket 011 Q2).
  It is a fail-loud correlation echo, never a dedup key.
- **Dialect normalization (ticket 011 Q6):** the node accepts v2-shaped
  `accepts` entries only. Soko accepts either wild dialect from the coworker
  (v1 JSON body or v2 base64 header transport) and normalizes to v2
  (`maxAmountRequired`→`amount`, network names→CAIP-2) before forwarding.
- `agentId` is required so the verification below is an exact lookup, not a
  `payTo` reverse search.

### What Soko does, in order

1. **Authz** — `requireTaskCollaboration` + `isCoworkerAgentContext`,
   identical to the `masumiPayment` task-event gate. Org and owner come from
   the task row. Sub-tasks are `Task` rows linked by `TaskLink` `PARENT`
   (there is no `Task.parentTaskId` column); the same per-task gate covers
   them. Ticket 003.
2. **Idempotency** — look up by `@@unique([taskId, idempotencyKey])`
   (`taskId` is required; it is the path param). Status-specific:
   - `VERIFIED` — return the stored live header. Do not charge or sign.
   - `FAILED` / `REFUNDED` — consume the key; return `409`.
   - `PENDING` — re-enter the sign path under a lease. **No second debit.**
     The reconciler must not refund a row that is mid-retry.
3. **Verify against the listed agent** — the 402's `payTo` + network + asset
   must match `agentId`'s registered payment source, the network must be in
   the per-env allowlist, and the scheme must be `exact`. Native-amount
   checks (still chain-native base units, **before** credit conversion):
   - **Fixed** — demanded amount must equal the advertised amount.
   - **Free** — reject a positive demand.
   - **Dynamic** — no advertised amount to match; the runtime 402 supplies
     asset + amount. Asset must be buy-side ready.
   On `main`, `PricingType` is `FIXED | FREE | UNKNOWN`. This stack adds
   `DYNAMIC`. The Dynamic gate **runs**: runtime 402 supplies asset +
   amount; `maxCredits` is mandatory after credit conversion. Any failure
   → `4xx` **before any charge**. Ticket 003.
4. **Price** — convert the demanded **native** amount to **credits** via the
   CAIP-19 `CreditCost` key (§ ticket 004) using **node-published** decimals
   for the `(network, asset)` pair, never the agent-registered scale.
   **Ceil to at least `MIN_CHARGEABLE_CREDITS`** (charge floor). Reject
   pre-charge if the asset has no `CreditCost` row (fail closed).
5. **Bound** — there is **no `Task.maxCredits` column**. After step 4,
   compare **converted credits** to optional request `maxCredits` (required
   for Dynamic). Do not compare native amount to `maxCredits`. The debit
   draws from the task organization's ordinary credit balance (the existing
   task-event charge helper: user + org). A per-task cumulative pool is
   **not built**. Insufficient balance → existing out-of-credits path, no
   partial state.
6. **Charge, then sign** — debit credits and create the payment record
   (`PENDING`) in one transaction; then call node `POST /x402/pay`.
7. **Resolve the sign result:**
   - **200 with a usable header** — persist `VERIFIED` **and the header on
     the row before returning the header**. Then return it. A crash after
     the coworker received the header must not auto-refund (the header is
     settleable). That case is review / future `EXPIRED_UNUSED`, not a
     sync refund.
   - **documented node refusal on the fresh first sign attempt** (400 / 402
     / 500 + documented envelope) — no header was written: refund
     synchronously, mark `FAILED`, return an actionable error. Ticket 006.
   - **same-key `PENDING` replay that the node refuses** — an earlier
     ambiguous attempt may still be live. Keep `PENDING`. Do not refund.
   - **crash / timeout / transport / malformed 200** — keep `PENDING` for
     same-key replay (re-enter sign, no second debit). A null header is
     **not** unsettleable (a lost 200 can hide a signed authorization).
     Do **not** auto-refund stale `PENDING`. Admin resolve after the
     sign-risk fence; unused expiry is future `EXPIRED_UNUSED`. The
     reconciler must not refund a row with an active sign lease.

### Response

Pass-through of the node's 200 plus Soko's record id:

```jsonc
{
  "paymentId": "soko payment-record id (support / admin refund / status)",
  "attemptId": "node attempt id",
  "xPaymentHeader": "base64 value to replay with",
  "caip2Network": "...", "asset": "...", "amount": "...", "payTo": "..."
}
```

## 4. Data model — `TaskX402Payment`

Sibling of `TaskPaymentClaim`, not a reuse — the escrow claim's Cardano
retry ladder and `blockchainIdentifier` are meaningless here. This row
**does** carry a **sign lease** (`processingAt`, `signAttemptCount`,
`signRiskExpiresAt`) because the node has no idempotency. Terminal at
successful sign. Conceptual sketch, not a migration.

```prisma
model TaskX402Payment {
  id             String   @id @default(uuid(7))
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  idempotencyKey String                 // coworker-supplied
  status         TaskX402PaymentStatus @default(PENDING) // PENDING|VERIFIED|FAILED|REFUNDED

  // What was requested / signed
  caip2Network   String
  asset          String
  amount         String                 // base units, chain-native
  decimals       Int                    // node-published scale used at charge
  payTo          String
  attemptId      String?                // node attempt id, present once signed
  xPaymentHeader String?                // exact bearer header; persist before return
  signAttemptCount Int @default(0)      // bounded non-idempotent node calls
  processingAt   DateTime?              // active sign lease
  signRiskExpiresAt DateTime?           // latest possible unseen authorization expiry
  failureReason  String?
  // Phased settlement observation (ticket 011 Q3): stored now, consumed by a
  // later reconciler that checks EIP-3009 authorizationState after expiry —
  // consumed → settled-observed; unused → EXPIRED_UNUSED → post-hoc
  // auto-refund (provably unpaid). Terminal-at-VERIFIED until that ships.
  payerAddress   String?                // EIP-3009 `from`
  payloadNonce   String?
  paymentPayloadHash String?
  validBefore    DateTime?              // authorization expiry

  // Links: task identity, the charged agent (per-endpoint aggregation),
  // the credit debit, and its compensating refund.
  taskId         String
  agentId        String                 // FK → Agent, the aggregation key
  taskEventId    String?  @unique
  transactionId       String  @unique   // the credit charge
  refundTransactionId String? @unique   // the compensating refund, if any

  @@unique([taskId, idempotencyKey])     // the dedupe unique (ticket 003)
  @@index([agentId, status])             // per-endpoint refund aggregation (§5)
  @@map("task_x402_payment")
}
```

An append-only `TaskX402PaymentAction` mirrors `TaskPaymentClaimAction` for
admin refund/resolve attribution (FK-free, same reasoning).

## 5. Admin & observability

Ticket 006. Two levers, both hanging off the payment record:

- **Admin refund action** on a `TaskX402Payment` — goodwill / support-driven,
  writes a `TaskX402PaymentAction` and a compensating refund transaction.
  Mirrors the admin task-payment-claims surface.
- **Per-endpoint aggregation** — refund count, failure count, and any
  quality/rating signal grouped by `agentId`, surfaced in the admin
  dashboard so a bleeding endpoint can be **disabled / removed from the
  whitelist**. The `@@index([agentId, status])` backs this.

## 6. Environment & operator prerequisites

Cardano-parallel Preprod/Mainnet split (ticket 003):

- **Preprod:** every agent is listed (curation is not the gate); the guard is
  the network allowlist — **EVM testnet CAIP-2 ids only**.
- **Production:** curation/whitelist + mainnet networks.
- **Buy-side readiness (ticket 011 Q5):** composed Soko-side from
  `/x402/networks/available` + `/x402/budgets` (both per-chain today), reusing
  the cached last-known-value pattern from Cardano V2 readiness. The
  env-global `/rail-readiness` x402 checks remain the coarse health signal.
  `GET /x402/budgets` requires **admin permission** and returns every key's
  rows unless filtered — the client resolves its own key id via
  `/api-key-status` and passes the `apiKeyId` filter, because `/x402/pay`
  only draws on budgets granted to the calling key (verified against
  upstream `main`, `src/routes/api/x402/index.ts` + `pay.ts`).
- **Node setup per chain:** X402Network enabled, a funded purchasing EVM
  wallet bound to it, the Soko API key's `ChainIdLimit` covering the target
  `eip155:*` ids, and the key holding **admin permission** (the budgets
  readiness read above is admin-gated; without it readiness stays
  never-recorded and the x402 listing is hidden). Funding stays a manual
  verification.

## 7. External dependencies — RESOLVED (ticket 011, from upstream source)

All confirmed against masumi-payment-service `main`; see
[NODE-QUESTIONS.md](NODE-QUESTIONS.md) `## Answers`:

- **Error contract:** 400 = pre-sign rejection, 402 = budget/balance refusal,
  500 = config/signing failure. A documented refusal plus envelope proves
  only that **this call** issued no header. Synchronous refund is safe on
  the **fresh first attempt**. A `PENDING` replay refusal is not proof the
  earlier attempt never signed — keep the charge. Gateway / transport /
  malformed responses are ambiguous.
- **Idempotency: none by design** — Soko's key is the sole dedupe; a
  double-call costs node budget only, never user funds.
- **By-`attemptId` lookup:** not needed for correctness; paginate-and-match
  covers audit. Low-priority node nicety.
- **Dialect:** v2-shaped only; Soko normalizes (§3).
- The pinned-spec refresh via `fetch-specs` is **complete** — the pull was
  byte-identical to the existing pins, so there is no generated-client diff
  and no spec drift gating the build; the deployed nodes already run the
  current x402 surface.

## 8. Test strategy

- **Unit:** amount→credits conversion incl. charge-floor and decimals per
  asset; the verify-against-listed-agent matcher (payTo/network/asset,
  per-env allowlist); idempotent-replay returns the stored result without a
  second charge.
- **Route:** authz parity with `masumiPayment` (non-coworker rejected;
  unassigned task rejected); fail-closed listing (unpriced asset, wrong
  network, unready rail each drop the agent); charge-then-refund on a stubbed
  node refusal on a first attempt; timed-out `PENDING` stays held (a null
  header is not unsettleable); a `PENDING` mid-retry must not auto-refund;
  admin resolve after the sign-risk fence (§3).
- **Mutation-tested** on the money paths, per repo discipline: the charge
  floor, the idempotency unique, the provably-unpaid refund branch.
- Node interaction stubbed at the payment-client boundary (the pinned spec is
  the contract); one integration smoke against a testnet agent on preprod.
