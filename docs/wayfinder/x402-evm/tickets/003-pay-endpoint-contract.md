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
4. **Dedupe** — a mandatory coworker-supplied idempotency key,
   unique-constrained on the payment record (the `identifierFromPurchaser`
   of this rail); same key returns the stored result idempotently. Payload
   hashing cannot work: x402 402s carry no server nonce, so legitimate
   repeats are byte-identical.
5. **Authz** — exactly the `masumiPayment` task-event model:
   `requireTaskCollaboration` + `isCoworkerAgentContext`, org and owner from
   the task row. Sub-tasks are tasks (`parentTaskId`), so the same per-task
   gate covers them; no new permission concept, no org flag.

Interlock with the refund policy (006): sign-failure refunds credits
synchronously (provably unpaid); a crash between charge and sign leaves a
PENDING record that goes to review — not auto-refund — because it is not
provably unpaid. The durable payment record carries the idempotency key,
`attemptId`, agent link (for per-endpoint aggregation), and the admin
refund action. Field-level schema lands in the PR 1 spec (007).

> **Superseded by the ticket-011 answers:** (a) `paymentIdentifier` is stamped
> **only when the 402 advertises the payment-identifier extension** (the node
> 400s otherwise), not on every call; (b) a crash/timeout between charge and a
> confirmed sign result is **refund-safe**, not review-only — the node signs
> locally and never sends the buyer's request, so the stale-PENDING reconciler
> auto-refunds without consulting the node. See [PR1-SPEC.md](../PR1-SPEC.md)
> §3 and [NODE-QUESTIONS.md](../NODE-QUESTIONS.md) `## Answers`.

## Progress (superseded by Resolution above)

- **Trust boundary decided** (Sandro, 2026-08-11): the endpoint signs only
  for **listed agents** — the 402's `payTo` + network + asset must match a
  registered x402 agent's advertised payment source, and the amount is
  sanity-checked against that agent's registry pricing. No arbitrary-402
  signing; this is what makes the whitelist-disable lever and per-endpoint
  aggregation from the refund policy bite.
- **Environment nuance** (Sandro, same session): on preprod every agent is
  listed — curation is not the gate there. The preprod guard is the network
  allowlist: **EVM testnets only** (testnet CAIP-2 ids). Production pairs
  curation with mainnet networks. Mirrors the existing Cardano
  Preprod/Mainnet environment split; the pay endpoint therefore needs a
  per-environment EVM network allowlist, not just the agent-source match.
- Still open: request/response wire shape, dedupe/idempotency key,
  charge-then-sign compensation record, authz beyond coworker context.
