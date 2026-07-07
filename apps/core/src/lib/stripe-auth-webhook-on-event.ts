import * as Sentry from "@sentry/node";
import type Stripe from "stripe";

import { handleSubscriptionDeletedEvent } from "@/services/stripe-backed-subscription.service";
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

  console.info(`Unhandled Stripe event type: ${event.type}`);
}
