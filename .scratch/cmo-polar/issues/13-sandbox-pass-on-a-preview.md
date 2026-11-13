# 13: Sandbox pass on a preview

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), "Testing Decisions".

**What to build:** Proof that the whole feature works against Polar's sandbox on a preview deployment, with Polar's test card. This covers what the mocked tests cannot: real checkouts, real webhooks and their order, and the portal. Each scenario's evidence goes in the PR.

**Blocked by:** 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 14

**Status:** ready-for-human

- [ ] A new hire runs free, reaches the checkout, pays a monthly plan, and Cuso works with the month's credits.
- [ ] A second hire by the same person without paying the first is refused.
- [ ] A yearly plan grants one month at purchase.
- [ ] An upgrade charges the prorated difference and grants the prorated credits; a downgrade shows as pending.
- [ ] "Keep my plan" on a pending downgrade clears it at Polar, and the next renewal keeps the current tier and its credits.
- [ ] A cancel in the portal shows the end date and can be undone.
- [ ] A failed renewal pauses Cuso; a successful retry resumes him and grants the month.
- [ ] A top-up lands on the Cuso's Project with a 12-month expiry.
- [ ] A refund in Polar's dashboard writes off the rest of that order's credits.
- [ ] Start over on a subscribed Cuso ends the subscription at Polar.
- [ ] An existing Cuso with Starter credits works without a subscription.
- [ ] The PR's Evidence holds a screenshot or log line per scenario.
