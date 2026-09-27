import * as Sentry from "@sentry/node";
import type Stripe from "stripe";

import {
  notifyPaymentFailed,
  notifySubscriptionEnding,
  resolveBillingWalletByStripeCustomerId,
} from "@/helpers/billing-notifications";
import {
  handleCheckoutSessionCompletedEvent,
  handleSubscriptionCreatedEvent,
  handleSubscriptionDeletedEvent,
} from "@/services/stripe-backed-subscription.service";
import { stripeWebhookService } from "@/services/stripe-webhook.service";

export const BILLING_STRIPE_EVENT_TYPES: ReadonlySet<Stripe.Event.Type> =
  new Set(["invoice.paid", "customer.created"]);

export function isBillingStripeEventType(
  eventType: Stripe.Event.Type,
): boolean {
  return BILLING_STRIPE_EVENT_TYPES.has(eventType);
}

export async function handleStripeAuthWebhookOnEvent(
  event: Stripe.Event,
): Promise<void> {
  if (isBillingStripeEventType(event.type)) {
    await stripeWebhookService.handleEvent(event);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    try {
      await handleCheckoutSessionCompletedEvent(session);
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          stripeEventType: "checkout.session.completed",
        },
        extra: {
          eventId: event.id,
          sessionId: session.id,
        },
      });
      throw error;
    }
    return;
  }

  // Here and not in the plugin's onSubscriptionCreated hook: the plugin logs
  // and drops a hook error, so Stripe never retries it. A throw from onEvent
  // becomes a 400 and Stripe redelivers. The redelivery is safe because the
  // plugin skips creating a subscription row that already exists.
  if (event.type === "customer.subscription.created") {
    const subscription = event.data.object;
    try {
      await handleSubscriptionCreatedEvent(subscription);
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          stripeEventType: "customer.subscription.created",
          stripeSubscriptionId: subscription.id,
        },
        extra: {
          customer:
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id,
          eventId: event.id,
        },
      });
      throw error;
    }
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    try {
      await handleSubscriptionDeletedEvent(subscription);
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          stripeEventType: "customer.subscription.deleted",
          stripeSubscriptionId: subscription.id,
        },
        extra: {
          customer:
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id,
          eventId: event.id,
          subscription: subscription.id,
        },
      });
      throw error;
    }
    return;
  }

  // The two notifications below are best-effort and never throw: a retry
  // from Stripe would replay the plugin's own subscription handling for a
  // notification that cannot be worth it.
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    const wallet = await resolveWalletOrReport(invoice.customer, event);

    if (wallet && invoice.id) {
      await notifyPaymentFailed(wallet, { invoiceId: invoice.id });
    }
    return;
  }

  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object;
    // Stripe lists only the attributes that changed, so a false-to-true flip
    // is the one shape a cancellation at period end has. A resumed and
    // re-cancelled subscription flips again and is told again, under the
    // same event id when the period is the same.
    const setToEnd =
      event.data.previous_attributes?.cancel_at_period_end === false &&
      subscription.cancel_at_period_end;

    if (setToEnd) {
      const wallet = await resolveWalletOrReport(subscription.customer, event);

      if (wallet) {
        await notifySubscriptionEnding(wallet, {
          stripeSubscriptionId: subscription.id,
          cancelAt: subscription.cancel_at,
        });
      }
    }
    return;
  }

  console.info(`Unhandled Stripe event type: ${event.type}`);
}

/** The wallet behind a Stripe customer field, or null with the miss reported. */
async function resolveWalletOrReport(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  event: Stripe.Event,
) {
  const stripeCustomerId =
    typeof customer === "string" ? customer : (customer?.id ?? null);

  if (!stripeCustomerId) {
    return null;
  }

  try {
    return await resolveBillingWalletByStripeCustomerId(stripeCustomerId);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { stripeEventType: event.type },
      extra: { eventId: event.id, stripeCustomerId },
    });
    return null;
  }
}
