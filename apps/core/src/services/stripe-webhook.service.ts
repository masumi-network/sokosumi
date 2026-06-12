import * as Sentry from "@sentry/node";
import { organizationRepository } from "@sokosumi/database/repositories";
import { getOrganizationMetadata } from "@sokosumi/utils";
import type Stripe from "stripe";

import prisma from "@/lib/db/prisma";
import { handleCustomerCreatedEvent } from "@/services/stripe-customer-created.service";
import { handleInvoicePaidEvent } from "@/services/stripe-invoice-credit.service";
import { handleSubscriptionDeletedEvent } from "@/services/stripe-subscription-lifecycle.service";

/**
 * Sync an organization's stored invoice email when its Stripe customer
 * changes. User customers are managed through the auth system and need no
 * action here.
 */
async function handleCustomerUpdatedEvent(
  customer: Stripe.Customer,
): Promise<void> {
  const metadata = customer.metadata;
  if (metadata?.customerType !== "organization" || !metadata.organizationId) {
    return;
  }

  const organizationId = metadata.organizationId;
  const customerEmail =
    typeof customer.email === "string" ? customer.email : null;

  const organization =
    await organizationRepository.getOrganizationWithRelationsById(
      organizationId,
      prisma,
    );

  if (!organization) {
    console.log(
      `[webhooks/stripe] Organization ${organizationId} not found for customer ${customer.id}`,
    );
    return;
  }

  const { invoiceEmail } = getOrganizationMetadata(organization.metadata);

  if (invoiceEmail !== customerEmail) {
    await organizationRepository.updateOrganizationInvoiceEmail(
      organizationId,
      customerEmail,
      prisma,
    );
    console.log(
      `[webhooks/stripe] Updated organization ${organizationId} invoice email from ${invoiceEmail} to ${customerEmail}`,
    );
  }
}

export const stripeWebhookService = {
  /**
   * Dispatch a verified Stripe event to its handler. Runs inside the Better
   * Auth stripe plugin's `onEvent` — core's single Stripe webhook endpoint.
   * Throws on handler failure so the plugin responds non-2xx and Stripe
   * retries the event.
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
      case "customer.updated": {
        const customer = event.data.object;
        try {
          await handleCustomerUpdatedEvent(customer);
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
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        try {
          await handleSubscriptionDeletedEvent(subscription);
        } catch (error) {
          Sentry.captureException(error, {
            tags: {
              stripeEventType: event.type,
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
