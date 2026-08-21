---
title: USDC→credits pricing and spend controls
type: grilling
status: closed
claimed: sandro
blocked-by: [002-research-node-x402-and-registry.md]
---

## Question

How does a chain-native x402 amount become a credit charge, and what caps it?

Decide:

- CreditCost keys for EVM assets: ADR 0001 proposes CAIP-19-style ids
  (`eip155:8453/erc20:0x…`). Confirm, and decide decimals handling
  (USDC is 6; `calculateCents*` currently assumes what?).
- Rounding and minimums: `MIN_CHARGEABLE_CREDITS` interaction with
  micro-payments — a $0.001 Bazaar call may round to zero credits. Charge
  floor? Reject? Accumulate?
- Spend controls: there is no `Task.maxCredits`. What bounds x402 spend —
  org/user balance, a per-request cap, a per-task pool (not built)? How do
  Soko-side caps compose with the node's own x402 budgets (double budget —
  who wins, and what does the coworker see when the node refuses on budget)?
- Unknown assets: a 402 demanding an asset with no CreditCost row — reject
  pre-charge (fail closed, mirroring the Cardano availability rule)?

## Resolution

Decided by Sandro (2026-08-11); two points inherited, two grilled:

1. **CreditCost keys** (inherited from ADR 0001 decision 5, unobjected):
   CAIP-19-style ids — `eip155:8453/erc20:0x…`. **Decimals come from the
   node-published ready pair**, never the agent-registered amount row
   (USDC is 6 on Base today; do not hardcode per asset in Soko). Cardano
   keys unchanged.
2. **Unknown assets** (inherited pattern, unobjected): fail closed
   pre-charge — no CreditCost row for the demanded asset means the 402 is
   rejected before any debit, exactly like the Cardano availability rule.
3. **Micro-payments: charge floor.** Every payment charges at least
   `MIN_CHARGEABLE_CREDITS` — the conversion ceils and never goes below the
   floor. The existing invariant holds; dust calls yield Soko margin rather
   than loss; the per-call minimum is documented for coworkers.
4. **Spend caps: org/user credit balance, not a task pool.** There is no
   `Task.maxCredits` column. x402 charges use the same task-event credit
   helper as other task charges (user + org balance). Optional request
   `maxCredits` is a **per-intent** ceiling (mandatory for Dynamic,
   optional for Fixed) and is compared **after** native→credit conversion.
   A per-task cumulative budget is **not built**. Node Soko-key budgets
   are the operator backstop. A documented first-attempt refusal refunds
   synchronously; ambiguous outcomes remain held.
