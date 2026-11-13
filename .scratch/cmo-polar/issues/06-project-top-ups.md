# 06: Project top-ups

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), stories 38 to 44.

**What to build:** A member whose subscribed Cuso runs low buys a Project top-up for exactly that Cuso: three packs (5,000, 10,000, 25,000 credits at $0.03 per credit) in one Polar checkout. The credits land on his Project, last 12 months and are spent after the month's plan credits. CMO offers the top-up on its out-of-credits screens and in Settings, and no longer links to Sokosumi's billing page.

**Blocked by:** 02 A paid plan order grants a month of Project credits

**Status:** ready-for-agent

- [ ] A versioned Core route starts a top-up checkout for a Cuso and returns Polar's checkout URL with the three packs, discount codes off, and the same customer and metadata as a plan checkout.
- [ ] Any member may call it; it is refused when the Cuso has no active subscription, and answers 503 without Polar configuration.
- [ ] `order.paid` for a one-time pack purchase grants the pack's credits to the organization with the Project set, under the top-up reference type, keyed by the order, expiring 12 months after purchase; a redelivery grants nothing more.
- [ ] With plan credits and a top-up both present, a charge for the Project spends the plan credits first.
- [ ] The link to Sokosumi billing leaves the CMO overview payload and every CMO screen; the core client snapshot is regenerated.
- [ ] CMO shows "Top up" on the out-of-credits banner, the paused up-next state, the refusals and in Settings, only for a Cuso with an active subscription.
- [ ] Route-level tests cover the checkout route, the grant, its expiry and the refusal; component tests cover where the top-up is and is not offered.
