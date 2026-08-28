# PR 1 spec — Bazaar coworker x402 payment surface

> **Status:** approved (ticket 007) and **upgraded by the ticket-011 answers**
> — all seven node questions resolved from upstream `main` source
> ([NODE-QUESTIONS.md](NODE-QUESTIONS.md) `## Answers`); nothing external
> gates the build, and the deployed nodes already run the x402 surface. Every decision here traces to a closed ticket — links inline.
> Substrate: [ADR 0001](../../adr/0001-x402-evm-payment-rail.md).
>
> **Amended 2026-08-28 for masumi ADR 0016.** The payment node removed
> `GET /x402/budgets`. The x402 spend cap now lives on the calling API key as
> per-unit usage credits, and wallet access is a scope grant. Only §6's
> buy-side readiness and the two "budget" wordings in §7 change; the listing,
> pay, data-model, and refund decisions are untouched. The superseded text is
> named where it stood, not deleted silently.

## 1. Scope

API-only pay. Anyone can **list** x402/Bazaar agents on public
`GET /v1/agents`. A coworker assigned to a task can **pay** a 402 one of
them returned, charged to the task's org in credits, receiving a signed
`X-PAYMENT` header to replay with. No end-user hire flow or job row — the
coworker calls the agent **outside** Soko. Web `/agents` stays
Coworkers-only (SOK-805). A temporary gallery preview existed 2026-08-14
and was disabled; x402 is not advertised there.

Out of scope: masumi-job x402 (PR 2), direct CDP-Bazaar crawling (agents must
be Masumi-registered), end-user hireability.

The full loop (Patrick's four steps):

```
anyone   → GET  /v1/agents?kind=x402                (list; pick base URL)
coworker → call the Bazaar agent directly           (outside Soko) → 402
coworker → POST /v1/tasks/{taskId}/x402-payments     (forward the 402)
   soko  → charge task org in credits, POST node /x402/pay, persist record
coworker ← { paymentHeader: { x402Version, name, value }, attemptId, paymentId }
coworker → replay with paymentHeader.name/value     (outside Soko) → result
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
- **Fixed-price entries fail closed** — an agent appears only if payable *now*:
  1. curated/whitelisted (production; preprod lists all — see §6),
  2. entry type `X402` or `OPEN_API` with a valid **absolute HTTP(S)**
     type-specific discovery URL (`hasValidX402DiscoveryUrl`; anything else is
     dropped and logged `invalid_discovery_url`),
  3. every fixed source uses the `exact` scheme with an EVM `0x…` `payTo`
     (`upto` / `batch-settlement` never list),
  4. every fixed source carries `FIXED` pricing with at least one amount row,
     priced at the **node-published** asset decimals (never the
     agent-registered scale),
  5. every advertised asset resolves to a `CreditCost` row,
  6. its network is in the per-environment EVM allowlist (preprod = testnet
     CAIP-2 ids only),
  7. x402 buy-side readiness OK (§6),
  8. the `(network, asset)` pair has a locally trusted exact-EVM EIP-712
     domain.

  Same-`(network, asset)` rows that demand different prices are dropped as
  `conflicting_price` — the listing never picks one of two disagreeing
  registrations. The catalog predicate (curation/status/type plus the
  discovery-URL gate) is shared verbatim with the pay endpoint's agent
  lookup, so a coworker can never pay an agent the listing would not show.
- **`PricingType` on `main` is `FIXED | FREE | UNKNOWN`.** This stack adds
  `DYNAMIC` and stops mapping registry Dynamic → `UNKNOWN`. x402 Dynamic
  entries list with `pricingType: "dynamic"`; `isPayable` is true when
  every advertised network has a priced buy-side-ready asset, otherwise
  they stay visible as non-payable previews. The Dynamic/`maxCredits` pay
  gate **runs** on this stack.
- **Response shape has two discriminators.** `specification` selects the
  discovery URL. Bazaar rows return `x402ResourcesUrl` and a null
  `openApiSpecUrl`. OpenAPI rows return `openApiSpecUrl` and a null
  `x402ResourcesUrl`. `pricingType` selects fixed, dynamic, or mixed payment
  source shapes. Fixed sources include network, asset, decimals, `payTo`,
  native amount, and converted credits. Dynamic sources include network and
  `payTo` only. Every row also carries `isPayable`. Metadata uses the existing
  `AgentMetadataOverride`-aware helpers.
- Fixed-price listed ⇒ payable gives per-agent refund aggregation (§5) a
  stable population to count against. Dynamic payments use the same accounting
  and refund records, with the caller's mandatory `maxCredits` as the quote
  ceiling (compared in **credits**, after conversion).
- **Fail-closed granularity is per-AGENT, ratified at build review** (stack
  step 4): one unpriced x402 asset, disallowed x402 network, or unready pair
  hides the whole agent. Non-x402 payment rails are excluded first. Known
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
  "maxCredits": 2 // required for dynamic; recommended for fixed
}
```

- `evmWalletId` is **never** caller-supplied — Soko owns the purchasing
  wallet per environment/network.
- Task identity (`${taskId}_${paymentId}`) is stamped into the node
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
   (`taskId` is the path param, required). A canonical SHA-256 fingerprint
   binds the key to the narrowed protocol payload. Status-specific:
   `VERIFIED` validates the demand and returns the stored live header
   without charging or signing; unbound/mismatched/expired/purged header
   → `409`. `PENDING` re-verifies and may re-sign under a lease — **no
   second debit**; the reconciler must not refund a mid-retry row.
   `FAILED` / `REFUNDED` consume the key → `409`.
3. **Verify against the listed agent** — the 402's `payTo` + network + asset
   must match `agentId`'s registered payment source, the network must be in
   the per-env allowlist, and the scheme must be `exact`. Native-amount
   checks (chain-native base units, **before** credit conversion):
   - **Fixed** — demanded amount must be **≤ advertised** (`amountRow.amount`).
     Cheaper per-resource prices charge fewer credits (safe). Above the
     advertised ceiling is a manipulated 402 and is rejected.
   - **Free** — reject a positive demand.
   - **Dynamic** — no advertised amount to match; the runtime 402 supplies
     asset + amount. Asset must be buy-side ready.
   On `main`, `PricingType` is `FIXED | FREE | UNKNOWN`. This stack adds
   `DYNAMIC`. The Dynamic gate **runs**: runtime 402 supplies asset +
   amount; `maxCredits` is mandatory after credit conversion. Any failure
   → `4xx` **before any charge**. Ticket 003.
   Soko then narrows the forwarded 402 to that one verified requirement. It
   never forwards unverified sibling entries. For v2, the signed response's
   `accepted` terms must match every charged field, and the replay header
   restores the resource server's original requirement spelling.
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
   (`PENDING`) in one transaction; atomically take a bounded sign-attempt lease,
   then call node `POST /x402/pay`. Same-key retries never overlap an active
   node call and stop after `TASK_X402_MAX_SIGN_ATTEMPTS`.
7. **Resolve the sign result:**
   - **200 with a usable header** — parse and verify the signed authorization
     against the charged requirement. Persist `VERIFIED` **and the header on
     the row before returning the header**. Then return the protocol-aware
     descriptor. A crash after the coworker received the header must not
     auto-refund. Malformed or mismatched signed results return
     `502 x402_pay_outcome_unknown`, page operations, and keep `PENDING`.
   - **documented node refusal on the fresh first sign attempt** (400 / 402
     / 500 + documented envelope, no header written) — refund synchronously,
     mark `FAILED`, return an actionable error. Ticket 006. A same-key
     `PENDING` replay refusal does **not** refund: an earlier attempt may
     still be live.
   - **crash / timeout / transport / malformed 200** — keep `PENDING` for
     same-key replay (re-enter sign, no second debit). Persist
     `signRiskExpiresAt` before the node call. A null header is **not**
     unsettleable (a lost 200 can hide a signed authorization). Do **not**
     auto-refund stale `PENDING`. Admin resolve after the sign-risk fence;
     unused expiry is future `EXPIRED_UNUSED`. The reconciler must not
     refund a row with an active sign lease.

### Response

Protocol-aware replay header plus Soko's record id:

```jsonc
{
  "paymentId": "soko payment-record id (support / admin refund / status)",
  "attemptId": "node attempt id",
  "paymentHeader": {
    "x402Version": 2,
    "name": "PAYMENT-SIGNATURE", // or "X-PAYMENT" for v1
    "value": "base64 value to replay under `name`"
  },
  "caip2Network": "...", "asset": "...", "amount": "...", "payTo": "..."
}
```

The column that stores the bearer is `TaskX402Payment.xPaymentHeader`. The
coworker JSON field is `paymentHeader` (descriptor: version, header name,
value). The node's `POST /x402/pay` body still uses `xPaymentHeader`.

## 4. Data model — `TaskX402Payment`

Sibling of `TaskPaymentClaim`, not a reuse — the escrow claim's Cardano
retry ladder and `blockchainIdentifier` are meaningless here. This row
**does** carry a **sign lease** (`processingAt`, `signAttemptCount`,
`signRiskExpiresAt`) because the node has no idempotency. Successful sign
ends the automatic signing flow (`PENDING → VERIFIED`); the record is not
terminal — an admin goodwill refund may still move `VERIFIED → REFUNDED`.

The block below is a conceptual relationship sketch, not the migration source
of truth. Canonical fields, partial indexes, CHECK constraints, refund kind,
action relations, and header-purge indexes live in
`packages/database/prisma/schema.prisma` plus the ordered migrations.

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
  demandFingerprint String?             // SHA-256 exact replay binding
  attemptId      String?                // node attempt id, present once signed
  xPaymentHeader String?                // persist before return; bearer
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

  // Links: task identity, the charged agent (per-agent aggregation),
  // the credit debit, and its compensating refund.
  taskId         String
  agentId        String                 // FK → Agent, the aggregation key
  taskEventId    String?  @unique
  transactionId       String  @unique   // the credit charge
  refundTransactionId String? @unique   // the compensating refund, if any

  @@unique([taskId, idempotencyKey])     // the dedupe unique (ticket 003)
  @@index([agentId, status])             // per-agent refund aggregation (§5)
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
- **Per-agent aggregation** — refund count, failure count, and operator-action
  count grouped by `agentId`. The dashboard uses this data to identify a
  failing agent and remove it from the whitelist. The
  `@@index([agentId, status])` backs this query.

## 6. Environment & operator prerequisites

Cardano-parallel Preprod/Mainnet split (ticket 003):

- **Preprod:** curation is bypassed, but agents still must be online, use a
  supported exact scheme and valid recipient, and pass pricing, readiness, and
  the **testnet-only EVM network allowlist**. Fixed failures hide the agent;
  dynamic readiness failures produce a non-payable preview.
- **Production:** curation/whitelist + mainnet networks.
- **Buy-side readiness (ticket 011 Q5; amended 2026-08-28, masumi ADR 0016):**
  composed Soko-side from `/x402/networks/available` + `/api-key-status` +
  `/x402/wallets` + `/x402/wallets/balance`, reusing the cached
  last-known-value pattern from Cardano V2 readiness. The env-global
  `/rail-readiness` x402 checks remain the coarse health signal.
  `GET /x402/budgets` is **gone from the node** and the readiness sync no
  longer calls it. The spend cap is now per-key usage credits on
  `/api-key-status`: one credit ledger per key, keyed by unit
  `eip155:<chainId>:<asset>` and gated by `usageLimited`. That endpoint
  answers for the calling key only, so the cap read needs no `apiKeyId`
  filter and carries no foreign-row hazard. Superseded text, kept for
  readers of older tickets: readiness used to read `/x402/budgets`, which
  required admin permission and returned every key's rows unless filtered.
- A pair is ready only when the key's cap allows that exact unit and some
  Purchasing wallet the key can reach on the chain holds both positive native
  gas and a positive balance of the priced token. The cap is key-global, so
  nothing binds a chain to one wallet: the sync ranks the candidates and
  records the most-funded, tie-broken on wallet id. The cap gate asks whether
  the unit holds credit, not whether it holds enough. No price exists at sync
  time, so a nearly exhausted unit stays listed and the node refuses the
  charge with a 402. Missing or ambiguous wallet data fails closed. Core also
  requires a local trusted-domain entry for the exact `(network, asset)` pair.
  The resource server cannot supply this EIP-712 domain metadata. Current
  entries are Base Sepolia USDC (`USDC`, version `2`) and Base mainnet USDC
  (`USD Coin`, version `2`).
- **Node setup per chain:** X402Network enabled, a funded Purchasing EVM
  wallet the Soko key can reach on it, the Soko API key's `ChainIdLimit`
  covering the target `eip155:*` ids, and, when the key is `usageLimited`,
  credits for unit `<caip2Network>:<asset>` granted with
  `PATCH /api/v1/api-key`. Admin permission is **no longer required**, but
  **pay permission is**: the node applies one owner scope to both
  `/x402/wallets` and `/x402/pay`, so a scoped non-admin key is a first-class
  signer, yet the listing is read-authenticated while the charge is
  pay-authenticated. A key with only `canRead` reads the listing and 401s on
  every charge, so Soko requires `canPay` (admin also qualifies) before it
  lists any wallet. A `usageLimited` key holding
  no `eip155:` credit row at all is grandfathered uncapped by the node and
  stays payable, so an operator who expected a cap there has not set one.
  Funding stays a manual verification.

## 7. External dependencies — RESOLVED (ticket 011, from upstream source)

All confirmed against masumi-payment-service `main`; see
[NODE-QUESTIONS.md](NODE-QUESTIONS.md) `## Answers`:

- **Error contract:** the node handler documents 400 = pre-sign rejection,
  402 = usage-credit/balance refusal, and 500 = config/signing failure. One of
  those statuses plus the documented envelope proves only that the current
  call did not issue a header. It permits synchronous refund on the fresh
  first attempt; a PENDING replay remains held behind every earlier attempt's
  risk window.
  Gateway/transport statuses and malformed responses are also ambiguous.
- **Idempotency: none by design** — Soko's key is the sole dedupe; a
  double-call costs the node key's own usage credits only, never user funds.
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
