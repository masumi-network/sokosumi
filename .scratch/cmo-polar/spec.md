Decisions and vocabulary: `docs/adr/0068-cmo-sells-its-plans-through-polar.md`, `GLOSSARY.md` (CMO plan, CMO subscription, Project top-up, Project credits, Starter credits, Hiring Cuso).

## Problem Statement

CMO cannot take money. Every Hiring Cuso grants 10,000 Starter credits for free, Core's CMO subscription check always passes, and when a Cuso runs out of credits CMO sends the person to Sokosumi's billing page, where a top-up lands in the Organization credit pool instead of on that Cuso. A person who wants to pay for their Cuso has no plan to buy, and we have no recurring revenue from CMO.

## Solution

A person hires Cuso and goes through Hiring Cuso without paying: Cuso reads the site, builds the brand and writes the marketing strategy for free. The last step is a checkout at Polar, where the person picks one of three CMO plans, monthly or yearly. Once Polar confirms the payment, Cuso starts working and receives the plan's credits every month. Those credits belong to his Project and expire at the end of the month.

When a Cuso runs low, a member buys a Project top-up for exactly that Cuso, or an owner or admin moves him to a larger plan. Owners and admins cancel and change the payment method in Polar's customer portal. Without an active CMO subscription Cuso is paused. Cusos hired before this change keep their Starter credits and keep working until those are used up.

## User Stories

Hiring and checkout

1. As a person hiring Cuso, I want his research, brand and strategy work to cost me nothing, so that I see what he does before I pay.
2. As a person hiring Cuso, I want the hire to succeed without any credits in my organization, so that an empty new organization is not refused.
3. As a person finishing Hiring Cuso, I want a checkout as the last step, so that I can start Cuso working.
4. As a person at the checkout step, I want to see the three CMO plans with price and monthly credits, so that I can compare them.
5. As a person at the checkout step, I want to choose between monthly and yearly, so that I can pay ten months for twelve.
6. As a person at the checkout step, I want to be sent to Polar's hosted checkout with my interval's three plans, so that I pay on a page that handles cards, wallets and tax.
7. As a person at Polar's checkout, I want to switch between the three plans there, so that I can change my mind without going back.
8. As a person who paid, I want to return to CMO and see that the payment is being confirmed, so that I know nothing is lost while Polar's confirmation arrives.
9. As a person who paid, I want CMO to open on the chat as soon as the payment is confirmed, so that I can start working with Cuso.
10. As a person who left the checkout without paying, I want to land on the checkout step again when I come back, so that I can finish later.
11. As a person who has not paid, I want Cuso to be paused after the free work is done, with the reason shown, so that I understand why he does nothing.
12. As any member of the organization, I want to be allowed to pay at the checkout, so that the person who ran the hire can finish it without an owner.
13. As a person with one unpaid Cuso, I want a clear message when I try to hire another, so that I know to subscribe or end the first one.
14. As a person on the invite list who is refused a second unpaid hire, I want a link to the unpaid Cuso, so that I can continue there.
15. As a business customer, I want to enter my company and tax ID at Polar's checkout, so that my invoice is correct.

Credits from a CMO subscription

16. As a subscriber on a monthly plan, I want the plan's credits granted when each monthly payment succeeds, so that Cuso can work the whole month.
17. As a subscriber on a yearly plan, I want the monthly amount granted every month for twelve months, so that I get the same monthly allowance as on the monthly plan.
18. As a subscriber, I want unused plan credits to expire at the end of their month, as the plan says, so that the rule is the same every month.
19. As a subscriber, I want my plan's credits to be spendable only for my Cuso's Project, so that other work in the organization cannot use them up.
20. As a subscriber, I want to see my plan, the renewal date and the credits left in CMO's Settings, so that I know where I stand.
21. As a subscriber, I want one grant per payment even if Polar sends its confirmation twice, so that my balance is correct.
22. As an organization with three Cusos, I want each to have his own CMO subscription and credits, so that one busy Cuso cannot starve the others.
23. As a member of a paid Sokosumi organization without a Seat, I want to be told that I need a Seat to spend a Cuso's credits, so that the existing Seat rule stays consistent.

Changing, cancelling, failing

24. As an owner or admin, I want to move Cuso to a larger plan from CMO's Settings, so that he gets more credits right away.
25. As an owner or admin who upgrades, I want to be charged only the prorated difference and receive the prorated extra credits at once, so that I pay for what I get.
26. As an owner or admin, I want a downgrade to apply at the next renewal, so that the month I paid for stays as it is.
27. As an owner or admin, I want to see a pending downgrade in Settings, so that I know what the next renewal brings.
28. As an owner or admin, I want plan changes offered only within my interval, so that I am not shown options that do not work.
29. As an owner or admin, I want a link to Polar's customer portal, so that I can cancel, change the payment method and read invoices.
30. As an owner or admin who cancels, I want Cuso to keep working until the paid period ends, so that I get what I paid for.
31. As an owner or admin who cancelled, I want to see the end date in Settings and be able to undo the cancel in the portal, so that a mistake is cheap.
32. As a yearly subscriber who cancelled, I want the monthly grants to continue until the year ends, so that the paid year is honored.
33. As a member who is not an owner or admin, I want no portal or plan-change controls, so that I cannot cancel the organization's subscription by accident.
34. As a subscriber whose renewal payment fails, I want Cuso paused with a message that names the failed payment, so that I know to fix my card.
35. As a subscriber whose failed payment is collected later, I want Cuso to resume and the month's credits granted without doing anything, so that a card problem fixes itself.
36. As a subscriber whose payment retries all fail, I want the subscription to end and the checkout offered again, so that I can come back.
37. As a customer who was refunded, I want the unused credits of that payment removed, so that the refund and my balance agree.

Project top-ups

38. As a member with a subscribed Cuso, I want to buy a Project top-up from the out-of-credits screens and from Settings, so that Cuso continues mid-month.
39. As a member buying a top-up, I want three packs (5,000, 10,000, 25,000 credits at $0.03 per credit) in one Polar checkout, so that I pick the size there.
40. As a member, I want the top-up to land on the Cuso I bought it for, so that it does not disappear into the organization's shared credits.
41. As a member, I want top-up credits to stay for 12 months, so that a purchase late in the month is not lost at renewal.
42. As a member, I want the month's plan credits spent before my top-up, so that the credits that expire first are used first.
43. As a member with an unsubscribed Cuso, I want the top-up not offered, so that I do not buy credits a paused Cuso cannot use.
44. As a member, I want no link to Sokosumi's billing page on CMO screens, so that I am not sent to a purchase that does not belong to this Cuso.

Existing Cusos and ending a Cuso

45. As the owner of a Cuso hired before this change, I want him to keep his Starter credits and keep working, so that nothing breaks on release day.
46. As the owner of such a Cuso, I want the checkout offered once his Starter credits are used up, so that I can continue with a CMO plan.
47. As the owner of such a Cuso, I want to subscribe earlier if I choose, keeping the remaining Starter credits, so that I lose nothing by paying.
48. As a person who chooses Start over, archive or delete on a subscribed Cuso, I want a confirmation that says the subscription ends now without a refund and his credits are removed, so that I decide knowingly.
49. As a person who ended a Cuso, I want Polar to stop charging for him at once, so that I do not pay for a Cuso that no longer exists.
50. As a person who starts over, I want the new hire to run the free flow and the checkout again, so that the new Cuso has his own subscription.

Operating it

51. As an operator, I want sandbox and production Polar accounts selected by configuration, so that previews and local stacks never charge real cards.
52. As an operator, I want a deployment without Polar configuration to refuse checkouts with a clear error instead of crashing, so that Polar stays an optional integration.
53. As an operator, I want plan prices and credit amounts read from the Polar products, so that the dashboard and the app cannot disagree.
54. As an operator, I want every grant, write-off and refund visible in the organization's transaction history under its Project, so that support can explain a balance.
55. As an operator, I want a Polar event for an unknown organization or Project reported and acknowledged, so that Polar does not retry it until the endpoint is disabled.
56. As an operator, I want Sokosumi's Stripe plans, Seats and top-ups to behave exactly as before, so that this change carries no risk for Sokosumi billing.

## Implementation Decisions

Provider seam

- Core gets one Polar client module on the current Polar TypeScript SDK (1.x, dated API version import, pinned). It is the only place that talks to Polar and the only thing tests replace.
- Configuration is optional, like other optional integrations in Core's env schema: an access token, a webhook secret and the environment (`sandbox` or `production`). Without them the checkout, top-up, portal and plan-change routes answer 503 and the webhook route answers 503. Test defaults go in Core's test setup.
- The catalog (six plan products: three tiers × monthly and yearly; three top-up packs) is read from Polar and cached per process, as the Stripe subscription catalog is. Each product carries metadata: its kind (plan or top-up), tier slug and credits. Plan credits are the monthly amount on yearly products too.
- The Polar customer is the organization: its external customer id is the organization id. Every checkout carries metadata for the Project, the organization, the paying user and the kind.

Data

- A new model holds one CMO subscription per Project: Project, organization, Polar subscription id (unique), product, tier, interval, status, current period start and end, cancel-at-period-end, pending product, the last paid order id and its paid date. At most one non-ended row per Project.
- `CreditBucketReferenceType` gets two values, one for a CMO subscription's monthly grant and one for a Project top-up. Both write organization-owned buckets with the Project set (ADR 0067's scope).
- Grant keys are deterministic and ride on the existing unique key of the credit bucket: order id plus month index. A monthly order and a top-up use index 0; a yearly order uses 0 to 11. A redelivered or raced event ends on the unique constraint.
- A plan grant expires one month after its grant month starts (for a monthly plan, the order's period end). A top-up expires 12 months after purchase. The existing draw order (soonest expiry first, Project before pool) then gives: plan credits, top-up, Starter credits, pool.
- No change to Stripe tables, columns or enum values.

Webhook

- A signature-verified Polar route joins Core's existing signature-verified webhook router (beside the newsletter webhook), outside session auth. It verifies the raw body with the SDK's Standard Webhooks check, answers 403 on a bad signature and 202 on an unknown event type.
- `order.paid` is the only event that grants. By billing reason: subscription create and cycle grant the current month; subscription update grants the prorated extra credits (new monthly amount minus old, times the remaining share of the grant month, same expiry); a one-time purchase of a top-up pack grants the pack.
- Subscription events (created, active, updated, canceled, uncanceled, past due, revoked) only upsert the subscription row from the payload. Delivery order is not guaranteed, so an older payload never overwrites a newer state.
- `order.refunded` writes off what is left of the buckets that order granted, using the existing write-off path.
- An event whose organization or Project is unknown is reported to Sentry and acknowledged.

Yearly grants

- A scheduled Core job, modelled on the free-subscription sync, grants the monthly amount for active yearly subscriptions whose next grant month has begun, keyed by the last paid order id and month index, at the subscription's current tier. It grants nothing for a past-due or ended subscription.

The gate

- `isCmoSubscribed` becomes real and takes the Project. A Cuso may work when one of these holds: his Project has an active CMO subscription (a scheduled cancel counts until the period ends; past due does not); or he is still in free hiring; or he holds Starter credits that are not used up.
- Core's hiring steps get a `checkout` step between `accounts` and `done`. Hiring is `done` only with a CMO subscription. A Cuso hired before this change who is already `done` stays `done`.
- Free hiring: while a Cuso has never had a CMO subscription, holds no Starter credits and his strategy is not approved yet (Launch, ADR 0068), his work is not charged, and the turn funding gate lets it start. The exemption sits at the one place where a charge's Project is resolved from Cuso. After approval he is paused until a plan is paid; nothing the person must do between approval and the checkout (connecting accounts, the Launch step) hits the paused gate or a charge. Members' own Jobs, image jobs and Tasks in that Project are charged as before.
- The hire no longer grants Starter credits. Its funding gate keeps the Seat check and drops the balance check. The write-off helpers stay, for existing Starter credits and for the new buckets.
- One unpaid Cuso per person: the hire is refused when the hirer already has a live Cuso they hired that has never had a CMO subscription and holds no Starter credits. The refusal names that Cuso.

Core API (versioned routes, OpenAPI schemas, then regenerate the core client snapshot)

- Start a plan checkout for a Cuso: takes the interval, returns Polar's checkout URL with that interval's three plans, trial and discount codes off, and a success URL back to CMO. Any member. Refused when the Cuso already has a non-ended subscription.
- Start a top-up checkout for a Cuso: returns a checkout URL with the three packs. Any member. Refused without an active subscription.
- Change plan: takes a tier of the same interval. Owners and admins. An upgrade uses immediate invoicing; a downgrade is scheduled for the next period.
- Portal link: returns a Polar customer session URL for the organization. Owners and admins. Plan changes are switched off in Polar's portal settings, because the portal cannot limit them to one interval.
- The CMO overview's billing block carries tier, interval, status, period end, cancel-at-period-end, pending tier, available credits and whether the viewer may manage billing. The link to Sokosumi billing leaves the payload.
- Ending a Cuso (Start over, archive, delete, moving him to a version outside CMO) revokes his Polar subscription first, then runs the existing write-off in one transaction. If Polar refuses, nothing is ended and the person sees an error.

CMO

- The flow gets a last step after Launch: plan cards, a monthly or yearly switch, and the redirect. Returning from Polar shows a confirming state that refreshes the overview until the subscription is active. The step is derived from Core's overview, as every other step is; CMO stores nothing (ADR 0062).
- The step is named so it does not collide with the existing "Plan" step (the marketing strategy); the commit that removed the earlier mock pricing step is prior art for the screen.
- Paused screens and the Settings card offer, by state: subscribe (no subscription), top up and upgrade (subscribed, out of credits), fix payment (past due). Settings shows tier, interval, renewal or end date, pending downgrade, credits, and for owners and admins the plan change and the portal link.
- Start over and the other ending actions get the confirmation text from story 48.
- Cuso's context packet keeps its "paused: no CMO subscription" line, now driven by the real gate.

Setup only a human can do

- In Polar sandbox and production: create the nine products with metadata, the webhook endpoint and secret, an access token with checkout, customer session, subscription and product scopes, switch off portal plan changes, and set the environment variables for Core's Vercel projects. Generate a `/wizard` script for this.

## Testing Decisions

- Tests assert external behavior at two seams and never Polar's or Prisma's internals: what Core answers and writes for a request, and which step and screens CMO derives from an overview.
- Seam 1, Core over HTTP: route-level tests post signed Polar events to the webhook route and call the CMO routes, with the Polar client module replaced and Prisma mocked beside the test. They cover: one grant per paid order and none on redelivery; no grant on a cycle without payment; prorated grant on upgrade; top-up grant and its 12-month expiry; refund write-off; state upserts out of order; bad signature, unknown event type, unknown organization; 503 without configuration; role checks on portal and plan change; refusals (second subscription, top-up without subscription, second unpaid hire); ending a Cuso revokes then writes off, and does neither when Polar refuses.
- The gate and free hiring are covered through the overview route and the charging path: free while hiring, paused from strategy approval until a plan is paid, active with a subscription, paused when past due, active with Starter credits left, paused with pool credits only.
- The yearly grant job is tested as a service with a fixed clock: twelve grants, none while past due, the new tier after a downgrade applied.
- One `*.postgres.test.ts` covers the money race: two concurrent `order.paid` deliveries for the same order produce one bucket.
- Seam 2, CMO: the step derivation is a pure function with existing tests; extend it for the checkout step, the confirming state and existing Cusos. Component tests cover the checkout step, the Settings card per role and state, and the paused screens.
- Prior art: the Stripe invoice credit service tests, the CMO billing and hiring service tests, the CMO route tests, the newsletter webhook route, the free-subscription sync tests, and CMO's step and page tests.
- A manual pass in Polar's sandbox with the test card covers what mocks cannot: checkout, renewal, upgrade, cancel, failed payment, top-up and refund, end to end on a preview.
- Cuso's context packet changes when the gate becomes real, so the Cuso evals run and their table goes in the PR's Evidence (docs/agents/evals.md).

## Out of Scope

- Embedding Polar's checkout in CMO (follow-up).
- Switching a subscription between monthly and yearly; the person cancels and subscribes again.
- Any change to Sokosumi's Stripe plans, Seats, top-ups or the Stripe-named columns.
- Restricting which charges a Project's credits may pay; ADR 0067's rule stays.
- A cap on what free hiring may cost per Cuso, beyond one unpaid Cuso per person and the hire allowlist.
- Our own emails for failed payments, renewals or receipts; Polar sends its own.
- Trials, discount codes, currencies other than USD.
- Showing CMO subscriptions on Sokosumi's billing page or in the Apple apps.
- Admin tooling to grant, move or refund CMO subscriptions; refunds are made in Polar's dashboard.

## Further Notes

- `order.paid` is the grant event because `subscription.cycled` also fires when the renewal payment fails. Polar documents no event id in the payload and no ordering guarantee, hence the order-based keys and the newest-state rule.
- Polar retries a failed delivery ten times and disables the endpoint after ten consecutive failures; handlers must acknowledge what can never succeed.
- In an organization on Sokosumi's free plan every member is seated, so a CMO-only organization has no Seat step. In a paid Sokosumi organization an unseated member cannot spend a Cuso's credits, as today.
- The portal belongs to the organization as Polar's customer, so it lists every Cuso's subscription of that organization.
- Free hiring relies on the hire allowlist and the one-unpaid-Cuso rule; if the allowlist is opened, revisit the cap listed under Out of Scope.
- ADR 0062 still describes a mock plan that was removed; correct it when touching that area.
