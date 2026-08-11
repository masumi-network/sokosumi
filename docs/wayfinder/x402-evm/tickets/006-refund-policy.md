---
title: Refund policy when a paid call returns garbage
type: grilling
status: closed
claimed: sandro
blocked-by: []
---

## Question

x402 has no escrow and no clawback. When credits are charged, the payment is
signed, and the outcome is bad — who eats it?

This is ADR 0001's named rollout blocker, and PR 1 makes it sharper: the
coworker calls the agent *outside* Soko, so Soko never sees the result at
all and cannot even judge "garbage". Decide once, for both PRs:

- PR 1 (Bazaar, API-only): caveat emptor — credits spent are spent? Or any
  compensation path (and on what evidence, given Soko sees nothing)?
- PR 2 (masumi jobs): Soko does see the result. Refund credits on failed
  replay / garbage result, with Soko absorbing the on-chain loss? Bounded
  how?
- The genuinely ambiguous case from the ADR: a timed-out replay where the
  payment may or may not have been taken. Assume taken?

Since charting, the source-of-truth ticket established that settlement
contract is **per payment source**, not per agent: *Disputable (Masumi)* =
escrow, refundable; *x402 direct settlement* = no refunds, by construction.
So the policy can be stated per settlement layer rather than per rail — and
"pick the disputable source when both are offered" is itself a possible
policy lever.

Product decision — needs Patrick (or whoever owns credits P&L) in the loop,
not just engineering. HITL.

## Resolution

Decided by Sandro (2026-08-11), grilled in three questions:

1. **PR 1 (Bazaar coworker payments): no automatic refunds.** Documented
   policy — credits spent are spent; Soko has no visibility into the
   outcome. Two levers ship with it: an **admin refund action** on the
   payment record (goodwill, support-driven, mirrors the admin
   task-payment-claims surface), and **per-endpoint failure/refund
   aggregation** in the admin dashboard — refund counts and bad-quality
   signals per external endpoint, so problematic agents can be disabled /
   removed from the whitelist.
2. **PR 2 (masumi x402 jobs): auto-refund only when provably unpaid.**
   Credits return automatically only when Soko provably never put funds at
   risk — the payment was never signed, or the replay was never sent.
   Everything after signing (settled, garbage result, non-2xx, timeout)
   keeps the debit; the admin lever is the only path. The ADR's ambiguous
   timed-out replay is answered by construction: signed-but-timed-out is
   not provably unpaid → no auto-refund. There is deliberately NO parity
   with escrow-job refunds.
3. **Disputable-vs-x402 source preference is moot**: by registry design
   those are different agents — a single agent never offers both settlement
   layers, so no selection rule exists.

Consequences for open tickets: the pay-endpoint contract (003) must make
"provably unpaid" a first-class state (sign-failure refunds synchronously)
and count refunds per endpoint; the listing surface (005) inherits the
whitelist/disable gate; ADR ratification (008) folds this in as the resolved
rollout blocker.
