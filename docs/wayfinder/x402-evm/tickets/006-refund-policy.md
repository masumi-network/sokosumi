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

> **Safety correction, 2026-08-17, then aligned vs `main` 2026-08-19.** The
> original resolution treated all non-200 responses and unsent replays as
> provably unpaid. That rule is superseded. The corrected policy follows.

1. **PR 1 (Bazaar coworker payments): auto-refund only when unsettleable.**
   No result-based auto-refund. Persist `VERIFIED` **before** returning the
   header. Core refunds a documented node-owned refusal synchronously only
   on the **fresh first** sign attempt when no header was written. Other
   sign outcomes remain PENDING. Crash-after-delivery is review / future
   `EXPIRED_UNUSED`. Operators can resolve a PENDING row after its
   sign-risk fence, or grant a goodwill refund for a VERIFIED row. The
   dashboard groups refund and failure signals by `agentId`.
2. **PR 2 (masumi x402 jobs): auto-refund only when provably unpaid.** Same
   documented-refusal rule. Transport failure, gateway response, timeout,
   malformed 200, or lost response can hide a signed authorization — keep
   PENDING. A non-2xx or timed-out replay after header delivery keeps the
   debit. Future observer may refund only after unused expiry. No parity
   with escrow-job refunds.
3. **Disputable-vs-x402 source preference is moot**: by registry design
   those are different agents — a single agent never offers both settlement
   layers, so no selection rule exists.

Consequences for open tickets: the pay-endpoint contract (003) must make
"unsettleable" a first-class state. A documented refusal refunds
synchronously only on the fresh first sign attempt. A same-key replay
refusal does not clear risk from an earlier ambiguous call and remains
PENDING until all prior risk windows expire or settlement evidence proves
them unused. The dashboard counts refunds per agent. The listing surface
(005) inherits the whitelist/disable gate; ADR ratification (008) folds
this in as the resolved rollout blocker. Canonical write-up: PR1-SPEC §3.
