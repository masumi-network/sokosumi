---
title: "PR 1 spec: Bazaar coworker payment surface"
type: prototype
status: closed
claimed: sandro
blocked-by: [003-pay-endpoint-contract.md, 004-pricing-and-spend-controls.md, 005-coworker-listing-surface.md, 006-refund-policy.md]
---

## Question

Assemble the implementation-ready PR 1 spec from the resolved decisions:
endpoints with schemas, the payment record model + migration sketch, charge/
sign/compensate flow, dedupe, authz, error taxonomy, operator prerequisites
(node wallets/budgets), and test strategy. Draft as an artifact to react to;
iterate with the human until it is handoff-ready. This ticket closing is half
the destination.

## Resolution

Spec drafted and approved by Sandro (2026-08-11) on first review, no changes
requested: [`../PR1-SPEC.md`](../PR1-SPEC.md).

The three review items resolved as drafted (approval = accept):

1. **Endpoint path:** task-nested `POST /v1/tasks/{taskId}/x402-payments`
   (matches the task-scoped charge decision).
2. **Request carries `agentId`** — the coworker names the listed agent
   explicitly; verification is an exact lookup, not a `payTo` reverse
   search.
3. **§7 external gaps acknowledged as ship-gating** — the design degrades
   safely around the four pinned-spec unknowns, but the node team's answers
   (ticket 011) must land before ship; the refund-on-refusal branch in
   particular is designed-but-unconfirmed until the node's error contract is
   known.

Handoff-ready. First half of the destination reached.
