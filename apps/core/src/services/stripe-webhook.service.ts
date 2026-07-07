import * as Sentry from "@sentry/node";
import type Stripe from "stripe";

import { handleCustomerCreatedEvent } from "@/services/stripe-customer-created.service";
import { handleInvoicePaidEvent } from "@/services/stripe-invoice-credit.service";

export const stripeWebhookService = {
  /**
   * Dispatch a verified Stripe event to its handler. Throws on handler
   * failure so the route can respond 5xx and Stripe retries the event.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "invoice.paid": {
        const invoice = event.data.object;
        try {
          await handleInvoicePaidEvent(invoice);
        } catch (error) {
          Sentry.captureException(error, {
            tags: {
              stripeEventType: event.type,
              invoiceId: invoice.id,
            },
            extra: {
              eventId: event.id,
              invoice: invoice.id,
              customer:
                typeof invoice.customer === "string"
                  ? invoice.customer
                  : invoice.customer?.id,
            },
          });
          throw error;
        }
        break;
      }
      case "customer.created": {
        const customer = event.data.object;
        try {
          await handleCustomerCreatedEvent(customer);
        } catch (error) {
          Sentry.captureException(error, {
            tags: {
              stripeEventType: event.type,
              customerId: customer.id,
            },
            extra: {
              eventId: event.id,
              customer: customer.id,
              email: customer.email,
            },
          });
          throw error;
        }
        break;
      }
      default: {
        console.info(
          `[webhooks/stripe] Unhandled Stripe event type: ${event.type}`,
        );
        break;
      }
    }
  },
};
