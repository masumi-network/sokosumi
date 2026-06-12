import * as Sentry from "@sentry/node";
import { organizationRepository } from "@sokosumi/database/repositories";
import { getOrganizationMetadata } from "@sokosumi/utils";
import type Stripe from "stripe";

import prisma from "@/lib/db/prisma";

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
   * Dispatch a verified Stripe event to its handler. Throws on handler
   * failure so the route can respond 5xx and Stripe retries the event.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
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
      default: {
        console.info(
          `[webhooks/stripe] Unhandled Stripe event type: ${event.type}`,
        );
        break;
      }
    }
  },
};
