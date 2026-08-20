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

1. **PR 1 (Bazaar coworker payments): auto-refund only when unsettleable.**
   Soko has no visibility into the externally-fetched result, so there is
   **no result-based auto-refund**. Credits return synchronously only when
   no header was ever written — a documented node refusal on the **fresh
   first** sign attempt. After a header exists (on the row or returned to
   the coworker), the debit stands. Persist `VERIFIED` before returning
   the header. Crash-after-delivery is review / future `EXPIRED_UNUSED`,
   not a sync refund. Two other levers: an **admin refund / resolve
   action** on the payment record (goodwill or wedged `PENDING`), and
   **per-agent failure/refund aggregation** feeding whitelist-disable.
2. **PR 2 (masumi x402 jobs): auto-refund only when provably unpaid.**
   Credits return automatically only when Soko provably never put funds at
   risk — a **pre-sign `POST /x402/pay` refusal** (any non-200, so no header
   is ever issued) triggers a synchronous refund, as does a replay that was
   never sent. Once a header is signed the debit stands: a settled payment, a
   garbage result, or a **non-2xx / timed-out replay** keeps the debit — the
   agent holds a settleable header — and the admin lever is the only path. The
   ADR's ambiguous timed-out replay is answered by construction:
   signed-but-timed-out is not provably unpaid → no auto-refund. There is
   deliberately NO parity with escrow-job refunds.
3. **Disputable-vs-x402 source preference is moot**: by registry design
   those are different agents — a single agent never offers both settlement
   layers, so no selection rule exists.

Consequences for open tickets: the pay-endpoint contract (003) must make
"unsettleable" a first-class state (first-attempt sign-failure refunds
synchronously; `PENDING` replay does not) and count refunds per agent; the
listing surface (005) inherits the whitelist/disable gate; ADR ratification
(008) folds this in as the resolved rollout blocker. Canonical write-up:
PR1-SPEC §3.
