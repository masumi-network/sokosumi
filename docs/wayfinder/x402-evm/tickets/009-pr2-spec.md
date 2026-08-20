---
title: "PR 2 spec: masumi-job x402 rail"
type: prototype
status: closed
claimed: sandro
blocked-by: [008-ratify-adr-0001.md]
---

## Question

Assemble the implementation-ready PR 2 spec from the ratified ADR: the
`paymentRail` discriminator and backfill, `JobX402Payment` schema, the
call→402→pay→replay job flow with its failure/ambiguity handling per the
decided refund policy, CAIP-19 credit-cost extensions shared with PR 1,
readiness gating per EVM network, flag/rollout strategy, and test strategy.
Draft as an artifact to react to; iterate until handoff-ready. This ticket
closing completes the destination.

## Resolution

Spec drafted and approved by Sandro (2026-08-11), three review points each
confirmed as specced: **flag-free rollout** (availability is the gate;
rollback fence = first `paymentRail=X402` row), **debit-stands-on-failed-
replay accepted for end users** (error copy explains; admin lever + future
expired-unused auto-refund), **rail filter on the job-sync selectors**
(x402 jobs never enter escrow sync). Spec: [`../PR2-SPEC.md`](../PR2-SPEC.md).
Second half of the destination reached.
