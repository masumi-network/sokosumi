# PR 1 spec: Bazaar coworker payment surface

Status: DRAFT for review (wayfinder ticket 007)
Decisions assembled from tickets 003, 004, 005, 006, 010; research in
`../research/`. ADR 0001 is the sibling design for PR 2.

## What ships

Two coworker-gated endpoints and one durable payment record:

1. `GET /v1/agents/x402` — list the x402 agents payable through Soko.
2. `POST /v1/tasks/{taskId}/x402-payments` — charge the task's org in
   credits and return a node-signed `X-PAYMENT` header for the coworker to
   replay against the agent.
3. `TaskX402Payment` — the audit/compensation record, plus its admin
   surface (refund lever, per-agent failure aggregation).

The coworker loop (Patrick's flow): list agents → call the agent's resource
directly (outside Soko) → receive `402 Payment Required` → POST it to Soko →
replay the original request with the returned header → the response is the
result. Soko never sees the request or the result.

Out of scope (map): end-user visibility/hireability, direct CDP-Bazaar
ingestion, masumi-job x402 rail (PR 2), payment-node/registry code.

## Decisions this spec is built on

| decision | ticket |
| --- | --- |
| Task-scoped: assigned coworker pays, task's org is charged | charting |
| No EVM keys in Soko; node signs via `POST /x402/pay` | ADR 0001 |
| Sign for **listed agents only**; per-env EVM network allowlist | 003 |
| Wire shapes modeled on the node's `/x402/pay` (raw 402 in, node 200 out) | 003 |
| Mandatory coworker idempotency key, unique per task | 003 |
| Authz = the `masumiPayment` task-event gate, sub-tasks included | 003 |
| CAIP-19 CreditCost keys; unknown asset fails closed pre-charge | 004 |
| Charge floor `MIN_CHARGEABLE_CREDITS` (ceil); task `maxCredits` pool | 004 |
| Listing: dedicated route, fail closed, coworker-only, override-aware | 005 |
| No auto-refunds after signing; sign-failure refunds synchronously | 006 |
| Admin refund lever + per-endpoint aggregation → whitelist disable | 006 |

## Registry / listing model

x402 agents are ordinary `Agent` rows (`type: X402`, `x402ResourcesUrl`,
EVM `AgentPaymentSource` rows with CAIP-2 `network`, ERC-20 `asset`,
`payTo`, `scheme`, `decimals`) — ingestion already exists. They stay
excluded from the end-user catalog (`type: STANDARD` filter, untouched).

`GET /v1/agents/x402` (coworker agent context required) returns agents where
ALL hold:

- production: `isShown` (the existing admin suppression bit doubles as the
  x402 whitelist); preprod: listed regardless (every agent listed there)
- every advertised EVM source's asset has a `CreditCost` row (CAIP-19 key
  `eip155:<chain>/erc20:<address>`)
- source network ∈ the per-environment allowlist (`X402_ALLOWED_NETWORKS`;
  preprod = testnet CAIP-2 ids only, production = mainnet)
- x402 buy-side readiness OK (`x402.purchasing_wallet` + `x402.budget`
  from `/rail-readiness`, cached last-known-value like Cardano V2 readiness
  — checks are environment-global today; per-network gating is a node ask,
  see 011)

Listed ⇒ payable right now. Response item: `id`, `name` / `description` /
`image` resolved through the metadata-override helpers (future read-only UI
display needs no rework), `x402ResourcesUrl`, `paymentSources[]`
(`network`, `asset`, `decimals`, `payTo`, `scheme`), `creditPricing[]`
(converted per source, floor applied), `status`.

## Pay endpoint

`POST /v1/tasks/{taskId}/x402-payments`

Authz: `requireTaskCollaboration` + `isCoworkerAgentContext` — identical to
the `masumiPayment` task-event gate; sub-tasks are tasks (`parentTaskId`),
same gate.

Request (modeled on the node's `/x402/pay`; Soko owns `evmWalletId`):

```jsonc
{
  "idempotencyKey": "aabbccddeeff001122334455",   // 16–128 [a-zA-Z0-9_-], required
  "paymentRequired": { /* the 402 body, forwarded verbatim */ },
  "preferredNetwork": "eip155:8453",               // optional, ^eip155:\d+$
  "preferredAsset": "0x…"                          // optional, ERC-20 address
}
```

`paymentRequired` is validated to the node's own schema (`x402Version`,
`accepts[1..20]` each with `scheme`/`network`/`asset`/`amount`/`payTo`/
`maxTimeoutSeconds`) — reject before charging what the node would reject.
v2 header-dialect 402s are accepted base64-encoded and decoded to the same
shape; the coworker forwards whichever dialect the agent spoke.

Validation, in order, all pre-charge (fail = no debit):

1. Schema-valid 402; at least one `accepts` entry survives the
   `preferredNetwork`/`preferredAsset` narrowing.
2. **Listed-agent match**: some surviving entry's `(payTo, network, asset)`
   matches an `AgentPaymentSource` of an agent the listing would return
   right now (same fail-closed predicate). No match → 422, nothing signed.
   The matched agent is recorded for aggregation.
3. Network ∈ per-env allowlist (redundant with 2 by construction, asserted
   anyway — defense in depth on the money path).
4. **Price sanity**: the entry's `amount` ≤ the matched source's advertised
   registry amount (guards a 402 demanding more than the listed price;
   equal is the normal case).
5. Credits = ceil(amount × CreditCost) floored at `MIN_CHARGEABLE_CREDITS`;
   cumulative task charges + this one ≤ task `maxCredits`; org balance
   sufficient.

Charge-then-sign, mirroring the debit-first pattern:

```
tx1 (serializable, like task-event charges):
  debit Transaction (task's org, owner from task row)
  TaskX402Payment PENDING  ← @@unique([taskId, idempotencyKey])
    P2002 → fetch existing row:
      SIGNED          → 200 with stored response (idempotent return)
      PENDING         → 409 "payment in progress"
      FAILED_REFUNDED → 409 "previous attempt failed; use a new key"
      REFUNDED        → 409 (admin already refunded)
node call (outside tx): POST /x402/pay
  { evmWalletId: <configured>, paymentRequired, preferred*,
    paymentIdentifier: <record id> }   // correlates node-side attempts;
                                        // semantics ask pending (011)
success → tx2: mark SIGNED, store attemptId/xPaymentHeader/payloadHash/
  signed tuple (update scoped on id+PENDING) → 200
definitive node error → tx2: FAILED_REFUNDED + compensating refund
  Transaction (provably unpaid per 006) → 502 with reason
timeout/ambiguous → leave PENDING, set reviewRequiredAt → 504-class error;
  NOT auto-refunded (not provably unpaid, per 006)
```

Response 200 — pass-through of the node's 200 plus the record id:

```jsonc
{
  "paymentId": "…",            // TaskX402Payment id (support / admin refund ref)
  "attemptId": "…",
  "xPaymentHeader": "…",        // base64; replay with this
  "payer": "0x…",
  "caip2Network": "eip155:8453",
  "asset": "0x…",
  "amount": "1000",             // base units actually signed
  "payTo": "0x…"
}
```

Node retries: none automatic. `/x402/pay` declares no idempotency (research
002), so Soko never re-POSTs a PENDING record; ambiguity goes to review.

## Data model

```prisma
model TaskX402Payment {
  id        String   @id @default(uuid(7))
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  idempotencyKey String
  status         TaskX402PaymentStatus @default(PENDING)
  failureReason  String?
  reviewRequiredAt DateTime?

  // what was requested / matched
  caip2Network String
  asset        String
  amountBaseUnits String        // ^\d+$, chain-native
  decimals     Int
  payTo        String
  paymentRequired Json          // the verbatim 402, for review/forensics

  // node leg (set on SIGNED)
  attemptId          String?
  xPaymentHeader     String?    // stored for idempotent same-key returns
  paymentPayloadHash String?

  taskId String
  task   Task @relation(fields: [taskId], references: [id], onDelete: Restrict)
  agentId String                // matched listed agent — aggregation identity
  agent   Agent @relation(fields: [agentId], references: [id], onDelete: Restrict)

  transactionId String @unique
  transaction   Transaction @relation("TransactionTaskX402Payment", …, onDelete: Restrict)
  refundTransactionId String? @unique
  refundTransaction Transaction? @relation("RefundedTransactionTaskX402Payment", …, onDelete: Restrict)

  @@unique([taskId, idempotencyKey])
  @@index([agentId, status])
  @@index([status, reviewRequiredAt])
  @@map("task_x402_payment")
}

enum TaskX402PaymentStatus {
  PENDING          // debited, not yet signed
  SIGNED           // header issued; terminal unless admin refunds
  FAILED_REFUNDED  // sign failed definitively; credits auto-returned
  REFUNDED         // admin goodwill refund after SIGNED
}
```

Statuses deliberately mirror the 006 policy: `FAILED_REFUNDED` is the only
automatic refund (provably unpaid); `SIGNED` is terminal-by-default.
`TaskX402PaymentAction` — append-only, FK-free operator audit rows — copies
the `TaskPaymentClaimAction` pattern verbatim for refunds.

Migration: one new table + enum + two Transaction relation columns.
Additive, no backfill, no existing-row impact.

## Stale-PENDING sweeper

A crash between debit and node call leaves PENDING with no outcome. The
existing `/sync/task-payment-claims` cron g