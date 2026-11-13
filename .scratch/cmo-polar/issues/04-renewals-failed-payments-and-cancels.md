# 04: Renewals, failed payments and cancels

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), stories 16, 18, 20, 30, 31, 34 to 36.

**What to build:** A monthly CMO subscription lives on after its first payment. Each paid renewal grants the month's credits again. A failed renewal grants nothing and leaves the subscription past due until Polar collects, at which point the month's credits arrive without anyone doing anything. A cancel runs to the end of the paid period. CMO's Settings shows the plan, the interval, the renewal or end date and the credits left.

**Blocked by:** 02 A paid plan order grants a month of Project credits

**Status:** ready-for-agent

- [ ] `order.paid` with billing reason subscription cycle grants the current tier's monthly credits, keyed by that order, expiring at the order's period end.
- [ ] A cycle event without a paid order grants nothing.
- [ ] Past due, canceled, uncanceled and revoked events update the subscription row; a revoked subscription is ended and the checkout is offered again.
- [ ] A scheduled cancel keeps the subscription active until the period end and shows the end date.
- [ ] A late payment after past due grants that month's credits once.
- [ ] CMO's Settings card shows tier, interval, renewal or end date and available credits from the overview, and names a failed payment when the subscription is past due.
- [ ] Route-level tests cover renewal, failed renewal, late collection, cancel, uncancel and revoke; a component test covers the Settings card in each state.
