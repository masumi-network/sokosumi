# 11: Change plan and open the portal

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), stories 24 to 29 and 33.

**What to build:** In CMO's Settings an owner or admin moves a Cuso to another tier of the same interval. An upgrade applies at once: Polar charges the prorated difference and Core grants the prorated extra credits for the rest of the month. A downgrade applies at the next renewal and shows as pending until then. Owners and admins also get a link to Polar's customer portal for cancelling, the payment method and invoices. Other members see neither control.

**Blocked by:** 04 Renewals, failed payments and cancels

**Status:** ready-for-agent

- [ ] A versioned Core route changes the plan: it takes a tier of the subscription's interval, uses immediate invoicing for an upgrade and next-period scheduling for a downgrade.
- [ ] A versioned Core route returns a Polar customer session URL for the organization.
- [ ] Both routes are for owners and admins of the organization only, and answer 503 without Polar configuration.
- [ ] A tier of the other interval, the current tier, and a subscription that is past due or scheduled to cancel are refused with a reason.
- [ ] `order.paid` with billing reason subscription update grants the new monthly amount minus the old, times the remaining share of the grant month, with the same expiry as the month's grant, once per order.
- [ ] A scheduled downgrade is stored as the pending tier and becomes the tier when Polar applies it; grants after that use the new amount.
- [ ] Settings shows the plan change, the pending downgrade and the portal link only when the viewer may manage billing.
- [ ] The core client snapshot is regenerated.
- [ ] Route-level tests cover upgrade, downgrade, the refusals, the role checks and the prorated grant; component tests cover Settings per role.
