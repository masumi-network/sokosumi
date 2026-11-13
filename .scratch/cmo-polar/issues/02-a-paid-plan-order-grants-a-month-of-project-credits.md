# 02: A paid plan order grants a month of Project credits

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204). Decisions: `docs/adr/0068-cmo-sells-its-plans-through-polar.md`, `docs/adr/0067-cuso-starter-credits-are-project-credits.md`.

**What to build:** When Polar reports the first paid order of a CMO plan for a Cuso, Core records that Cuso's CMO subscription and grants the plan's monthly credits as Project credits of his Project, expiring at the end of the month. The grant happens once per order, however often and in whatever order Polar delivers its events.

**Blocked by:** 01 Core talks to Polar

**Status:** ready-for-agent

- [ ] A new model holds one CMO subscription per Project: Project, organization, Polar subscription id (unique), product, tier, interval, status, current period start and end, cancel-at-period-end, pending product, last paid order id and its paid date; at most one non-ended row per Project. The migration is included.
- [ ] `CreditBucketReferenceType` gains one value for a CMO subscription's monthly grant and one for a Project top-up.
- [ ] `order.paid` with billing reason subscription create grants the tier's monthly credits to the organization with the Project set, keyed by order id and month index 0 on the bucket's existing unique key.
- [ ] The grant expires one month after its grant month starts (for a monthly plan, the order's period end).
- [ ] The Project, organization and paying user come from the checkout metadata on the order; the organization is also Polar's customer by external id.
- [ ] Subscription events (created, active, updated) upsert the subscription row from the payload; an older payload never overwrites a newer state.
- [ ] A redelivered `order.paid` grants nothing more and answers 2xx.
- [ ] An event for an unknown organization or Project is reported to Sentry and acknowledged.
- [ ] The grant shows in the organization's transaction history under its Project.
- [ ] Route-level tests with mocked Prisma cover the cases above; one `*.postgres.test.ts` proves two concurrent deliveries of the same order produce one bucket.
- [ ] No Stripe table, column or enum value changes.
