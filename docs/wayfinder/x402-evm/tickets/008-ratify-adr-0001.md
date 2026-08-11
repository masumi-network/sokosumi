---
title: Ratify ADR 0001
type: grilling
status: closed
claimed: sandro
blocked-by: [001-research-bazaar-mechanics.md, 002-research-node-x402-and-registry.md, 006-refund-policy.md]
---

## Question

Flip ADR 0001 from Proposed to Accepted — or amend it first.

Walk the ADR against what the research tickets established and what PR 1
decided, and settle the deltas: the refund-policy blocker (resolved by its
own ticket — fold the answer in), any drift between the pinned spec and the
ADR's description of `/x402/pay` and readiness checks, and whether PR 1's
payment-record model and the ADR's `JobX402Payment` stay siblings or share a
table. Update the ADR file in place; Accepted status is the resolution.

## Resolution

[ADR 0001](../../adr/0001-x402-evm-payment-rail.md) flipped **Proposed →
Accepted** (2026-08-11), edited in place. Two decisions grilled with Sandro:

1. **Accept now, caveats inline** — the design is settled, so ratification
   does not wait on the external node answers. Each node behavior the pinned
   spec does not guarantee is annotated `[pending node confirmation — ticket
   011]` in the ADR: the terminal attempt status, the missing by-`attemptId`
   lookup + absent `/x402/pay` error contract, per-network readiness, and
   `paymentIdentifier` semantics. They gate the PR 2 build, not the decision.
2. **Two sibling tables** — `JobX402Payment` (PR 2, job-scoped) and
   `TaskX402Payment` (PR 1, task-scoped) stay separate; shared logic factors
   into a helper. Recorded in ADR decision 3.

Also folded in: the **refund policy** (ticket 006) now resolves the ADR's
former blocking product decision — the "Open product decision" section is
retitled *Credit-refund policy (resolved)*; and a Cardano-V2-readiness
mischaracterization in the proposed draft (claimed TTL'd; it is not) was
corrected against the code.
