---
name: polar-migration
description: |
  Guide for migrating to Polar from other payment platforms (Stripe Billing, Paddle, Lemon Squeezy). Use this skill when: (1) Planning a migration from another payment provider to Polar; (2) Moving customers, subscriptions and saved cards with Polar's Stripe migration; (3) Running both billing systems during the transition; (4) Mapping products and pricing between platforms; (5) Updating webhook and access handling for migrated subscriptions; (6) Communicating the migration to customers; (7) Testing the migration in sandbox first.
---

# Polar Migration Guide

[Polar's migration guide](https://polar.sh/docs/migrate) is the source of truth; read it before recommending anything. This skill summarizes what the application has to do.

## Pick the path

- **From Stripe:** use Polar's assisted migration under **Settings → Migrations**. Polar imports products, prices and customers, Stripe copies saved cards straight to Polar's payment processor, and Polar switches each subscription over with the same paid period. Most customers don't need to do anything. Migrations are rolling out gradually; if the tab is missing, contact [Polar support](https://polar.sh/docs/support).
- **From Paddle, Lemon Squeezy or anything else:** there's no automated migration. Contact Polar support first, then follow "Other providers" below. Customers move by checking out again on Polar.

## Rules for every migration

- Never stop, cancel or pause the old provider's billing, or activate a migrated Polar subscription, outside Polar's switch. Don't write your own cutover scripts: they double-bill.
- Never handle raw card data, and never ask for Stripe or Polar secrets in chat.
- Use the application's immutable customer ID as the Polar customer `external_id` (passed as `external_customer_id` at checkout). Not email, and not the old provider's ID unless that's already the app's canonical ID. An `external_id` can't be changed once set.
- Each subscription must have exactly one system responsible for its next renewal. Record which one, rather than inferring it from which IDs are set.
- Past payments stay in the old provider. Don't create Polar orders for transactions Polar didn't process, and keep the old account for refunds, disputes and accounting.

## From Stripe

The dashboard handles connecting Stripe, importing the catalog, copying cards and switching subscriptions. The application handles the first and last stages and the events in between.

### 1. Move new sales to Polar

Integrate Polar checkout and webhooks first (`polar-integration`), passing `external_customer_id` on every checkout. New customers then subscribe on Polar while existing subscriptions keep renewing on Stripe. Keep the Stripe IDs in your database until nothing renews there.

During coexistence, access checks must accept a valid entitlement from either provider, and cancellations or plan changes go to whichever system bills that subscription.

### 2. Map imported customers

The import creates or reuses Polar customers, but Polar can't know your application's customer IDs. Match each imported customer once on an exact, unique email, then set your ID on customers whose `external_id` is still empty. Send missing, duplicate or changed emails for review instead of guessing.

```ts
import { polar } from "./polar"; // client from polar-integration

const customer = await polar.customers.get(polarCustomerId);
if (customer.external_id === null) {
  await polar.customers.update(polarCustomerId, { external_id: appCustomerId });
}
```

Imported products are new Polar products. Map each internal plan to its new Polar product and price IDs explicitly, never by name. Benefits aren't imported: attach them to the imported products before the switch if access depends on them.

### 3. Prepare for the switch

Polar stops each switched subscription on Stripe by canceling it immediately, without proration or a final invoice. Before switching:

- Turn off Stripe's canceled-subscription email (Settings → Billing → Subscriptions and emails) and pause any Stripe automation triggered by a cancellation.
- Make the Stripe `customer.subscription.deleted` handler ignore switched subscriptions, so it doesn't revoke access or send a cancellation email:

  ```ts
  if (subscription.cancellation_details?.comment?.startsWith("Migrated to Polar")) {
    return; // billing moved to Polar; reconcile through subscription.migrated instead
  }
  ```

- Handle Polar's `subscription.migrated` event as the cutover signal. It carries `provider` and `provider_subscription_id`. Treat it as an idempotent upsert: store the Polar subscription ID against the Stripe subscription and record Polar as the system that bills next. Don't grant or revoke access from it, and don't send a welcome email:

  ```ts
  case "subscription.migrated":
    await recordMigratedSubscription({
      stripeSubscriptionId: event.provider_subscription_id,
      polarSubscriptionId: event.data.id,
    });
    break;
  ```

Expect `subscription.updated`, `subscription.migrated` and `customer.state_changed` per switched subscription, in any order. Migration sends no `subscription.created` or `subscription.active`, and the import sends no `product.created` or `customer.created`.

### 4. Switch, reconcile and clean up

Run the switch from the dashboard. It can't be undone, and subscriptions renewing within 24 hours stay on Stripe until the next attempt. Afterwards, check that every moved subscription bills only in Polar and maps to one customer and entitlement. Retire Stripe checkout and subscription code only once no subscriptions renew there.

Limits to know up front: Stripe Connect platform accounts and Stripe accounts in India can't use the automated flow. Subscriptions sold through Stripe Managed Payments, and those with multiple items, a quantity above 1, or a past-due, unpaid or paused status, need attention or stay on Stripe. Only cards are copied, real card copies need live Stripe accounts, and the Stripe key mode must match the Polar environment.

For a full assessment, Polar's guide includes a [coding assistant prompt](https://polar.sh/docs/migrate#coding-assistant-prompt) that produces a migration plan and reconciliation contract before any code changes.

## Other providers

### Recreate the catalog

The billing interval belongs to the product, and a product has one fixed price per currency. Monthly and yearly billing are two products:

```ts
await polar.products.create({
  name: "Pro (Monthly)",
  recurring_interval: "month",
  prices: [{ amount_type: "fixed", price_amount: 2900, price_currency: "usd" }],
});
await polar.products.create({
  name: "Pro (Yearly)",
  recurring_interval: "year",
  prices: [{ amount_type: "fixed", price_amount: 29000, price_currency: "usd" }],
});
```

Recreate benefits (license keys, file downloads, Discord roles and others) and attach them with `polar.products.updateBenefits(productId, { benefits: [benefitId] })`.

### Move customers

Create customers ahead of time if you want them in Polar before they check out:

```ts
await polar.customers.create({ external_id: appCustomerId, email, name });
```

Paid subscriptions can't be created through the API, and saved cards can't move between processors outside Stripe's copy. Each customer checks out on Polar, where they enter their card. Send them a checkout link created with `external_customer_id`.

To avoid charging twice for the same period, schedule the old subscription to cancel at the end of its period, and give the Polar checkout a trial that covers the days left, using `trial_interval: "day"` and `trial_interval_count`. Check this approach with Polar support for your case.

### License keys

License keys can't be imported. Keep validating existing keys against the old provider during the transition; new purchases get Polar keys.

## Communicating with customers

- **Stripe migration:** no action is needed from customers. Polar adds a notice about the move to its first billing emails, such as the first renewal receipt. If you want customers to hear about it from you first, send a short heads-up before switching.
- **Other providers:** customers need to check out again. Tell them plainly that they'll enter their card on Polar, when they'll be charged, and that the old subscription ends at the end of its paid period.

## Testing

Run the migration in Polar's sandbox with a Stripe test-mode account first. Sandbox verifies the application side (customer mapping, `subscription.migrated` handling, access checks), but can't copy real cards. See `polar-testing` for sandbox setup and local webhook testing.
