---
title: Coworker pay-endpoint contract
type: grilling
status: closed
claimed: sandro
blocked-by: [001-research-bazaar-mechanics.md, 002-research-node-x402-and-registry.md]
---

## Question

What exactly does the Soko pay endpoint accept, do, persist, and return?

The flow to pin down: coworker got a 402 from a Bazaar agent → POSTs
something to Soko (task-scoped, per the charting decision) → Soko charges the
task's org in credits → delegates signing to the node (`POST /x402/pay`) →
returns something the coworker replays with.

Decide:

- Request shape: the raw 402 body forwarded verbatim, or parsed fields? Does
  the coworker name the agent/resource, and does Soko verify it against a
  listed agent or sign for any 402 presented?
- Response shape: the `X-PAYMENT` header value alone, or a payment record id
  plus the header?
- Ordering and compensation: charge credits before signing (matching the
  debit-first pattern) — and when signing fails, is the refund synchronous or
  does this need a TaskPaymentClaim-style durable record? What happens when
  signing succeeds but the coworker never replays (authorization signed,
  possibly never consumed)?
- Dedupe: what stops the same 402 being paid twice — payment identifier,
  nonce, resource+amount hash? Which key is unique, and is a second POST an
  error or an idempotent return of the first signature?
- Persistence: the `TaskX402Payment` (or similar) row — fields, status
  lifecycle, relation to task events and the existing charge machinery.
- Authz: `requireCoworkerAssignedTaskRead` equivalent; anything beyond the
  existing coworker-context checks?

## Resolution

Decided by Sandro (2026-08-11) across two grilling rounds. The endpoint is
**modeled after the node's own `POST /x402/pay`** on both sides of the wire:

> **Current contract, 2026-08-17.** The original five points and interlock
> paragraph record design history. PR1-SPEC §3 is authoritative. The
> correction below replaces the historical wire, retry, and refund details.

1. **Trust boundary — listed agents only.** The 402's `payTo` + network +
   asset must reverse-match a registered x402 agent's payment source, and
   the amount is sanity-checked against that agent's registry pricing. Plus
   a per-environment EVM network allowlist: preprod lists every agent but
   allows testnet CAIP-2 ids only; production pairs curation with mainnet.
2. **Request** — node-shaped: the coworker forwards the raw 402
   `paymentRequired` payload exactly as the node consumes it. Soko owns
   `evmWalletId` (never caller-supplied) and stamps task identity (task id,
   event id) into the metadata / `paymentIdentifier` slot.
3. **Response** — pass-through of the node's 200: `attemptId`,
   `xPaymentHeader`, and the signed network/asset/amount/payTo tuple.
4. **Dedupe** — `@@unique([taskId, idempotencyKey])` (`taskId` is the path
   param, required). Status-specific: `VERIFIED` returns the stored live
   header (no second charge or sign); `FAILED` / `REFUNDED` consume the
   key (`409`); `PENDING` re-enters sign under a lease with **no second
   debit**. Payload hashing cannot be the unique: x402 402s carry no
   server nonce, so legitimate repeats are byte-identical.
5. **Authz** — exactly the `masumiPayment` task-event model:
   `requireTaskCollaboration` + `isCoworkerAgentContext`, org and owner from
   the task row. Sub-tasks are `Task` rows linked by `TaskLink` `PARENT`
   (there is no `Task.parentTaskId` column); the same per-task gate covers
   them; no new permission concept, no org flag.

Interlock with the refund policy (006): a documented first-attempt
sign-failure with no header written refunds credits synchronously; a
crash between charge and a confirmed sign result stays `PENDING` for
same-key replay (no second debit). Persist `VERIFIED` **before**
returning the header. Auto-refund `PENDING` only when no header was ever
written. Canonical write-up: [PR1-SPEC.md](../PR1-SPEC.md) §3.

The endpoint accepts either supported wild 402 dialect and narrows it to one
verified v2 requirement. It returns a protocol-aware `paymentHeader`
descriptor. It stamps `${taskId}_${paymentId}` only when the requirement
advertises the extension. A canonical demand fingerprint binds
`(taskId, idempotencyKey)`. `VERIFIED` replay returns the stored live
header; `PENDING` re-enters sign under a lease with no second debit;
`FAILED` / `REFUNDED` consume the key. `signRiskExpiresAt` blocks
operator resolve while an unseen authorization can remain live. There is
no `Task.maxCredits`.

## Progress (superseded by Resolution above)

- **Trust boundary decided** (Sandro, 2026-08-11): the endpoint signs only
  for **listed agents** — the 402's `payTo` + network + asset must match a
  registered x402 agent's advertised payment source, and the amount is
  sanity-checked against that agent's registry pricing. No arbitrary-402
  signing; this is what makes the whitelist-disable lever and per-agent
  aggregation from the refund policy bite.
- **Environment nuance** (Sandro, same session): on preprod every agent is
  listed — curation is not the gate there. The preprod guard is the network
  allowlist: **EVM testnets only** (testnet CAIP-2 ids). Production pairs
  curation with mainnet networks. Mirrors the existing Cardano
  Preprod/Mainnet environment split; the pay endpoint therefore needs a
  per-environment EVM network allowlist, not just the agent-source match.
- Still open: request/response wire shape, dedupe/idempotency key,
  charge-then-sign compensation record, authz beyond coworker context.
