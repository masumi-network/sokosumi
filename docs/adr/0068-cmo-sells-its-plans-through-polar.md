# CMO sells its plans through Polar

- Status: Accepted
- Date: 2026-11-13

Sokosumi bills organizations through Stripe: a seat-based plan and top-ups into the **Organization credit pool** ([ADR 0019](0019-organization-credit-pool.md)). CMO had no payment of its own; every hire granted 10,000 **Starter credits** ([ADR 0067](0067-cuso-starter-credits-are-project-credits.md)) and Core's subscription check always passed. CMO now sells a **CMO subscription** per Cuso and **Project top-ups** through Polar, a merchant of record, so CMO's sales carry no tax filing of our own. Stripe stays as it is for Sokosumi. Two payment providers in one Core is deliberate: do not fold CMO's plans into the Stripe integration.

## Decisions

- **Core owns the integration.** Core calls the Polar SDK and receives Polar's webhooks itself. The `@polar-sh/better-auth` plugin is not used: its checkout belongs to a user and its organization support is experimental, while a CMO subscription belongs to a Cuso.
- **The ledger stays in Core.** One grant per paid Polar order, keyed by the order. Polar's meters and credits benefit are not used, because Polar does not block spending past the balance.
- **One subscription per Cuso.** Its credits are **Project credits** of his Project. An organization with three Cusos holds three subscriptions.
- **Three CMO plans.** $200 for 10,000 credits, $500 for 25,000, $1,000 for 50,000, per month. Yearly costs ten months and still grants month by month. A month's credits expire at the end of that month. USD only, no trial, no discount codes.
- **Starter credits end.** A hire grants nothing. A Cuso's work is not charged until Launch, and a person may have one unpaid Cuso at a time. Cusos hired before keep their Starter credits and work without a subscription until those run out.
- **The checkout is the last step of Hiring Cuso and is mandatory.** It is Polar's hosted checkout; any member who finishes the flow may pay.
- **The subscription is the gate.** Without an active one Cuso is paused, even when the Organization credit pool has credits. A failed renewal pauses him until Polar collects.
- **Plan changes stay within the interval.** An upgrade applies at once, with a prorated charge and prorated extra credits; a downgrade applies at the next renewal. Owners and admins change, cancel and pay through Polar's customer portal. A cancel runs to the period end.
- **Project top-ups cost more than a plan.** $0.03 per credit against a plan's $0.02, in packs of 5,000, 10,000 and 25,000. They expire 12 months after purchase, are spent after the month's plan credits, and need an active subscription. CMO no longer links to Sokosumi's top-up.
- **Ending a Cuso ends his subscription.** Start over, archive and delete cancel it at once without a refund and write off his credits, as ADR 0067 already does for Starter credits.
- **A refund writes off the rest.** When an order is refunded in Polar, Core writes off what is left of the credits it granted.

## Considered Options

- **The existing Stripe integration.** Less code and lower fees, but we would stay the seller of CMO.
- **Creem.** About 40% cheaper for non-US cards (3.9% + 40¢ against Polar's 5% + 50¢ + 1.5%), but one product per checkout, a portal that cancels at once, and its Moderation API required for generated images.
- **Paddle, Dodo Payments, Lemon Squeezy.** No account and no advantage that outweighs the Polar account we already have.
- **One subscription per organization.** A second hire's checkout would have nothing to sell.
- **A trial allowance instead of a free wizard.** A small grant written off at checkout; rejected for work that is simply not charged.

## Consequences

- ADR 0067's "they never expire" holds only for Starter credits. Project credits now also come with an expiry: a month for a plan's grant, 12 months for a top-up.
- The Organization credit pool still pays a Project's charges after his Project credits. CMO no longer advertises it.
- Billing columns, enum values and the webhook path are Stripe-named today. Polar needs its own or provider-neutral ones.
- The records that mirror Polar are provider-level and shared: `PolarSubscription` (with a `kind`, `CMO` its only value today, and an optional Project that CMO's paths require), `PolarOrder` and the `POLAR_SUBSCRIPTION_MONTH` credit buckets, handled by the `polar-*` services. Polar may later carry Sokosumi's subscriptions too. CMO's catalog, the gate and CMO's routes keep their CMO names.
- Embedding the checkout in CMO is a follow-up.
