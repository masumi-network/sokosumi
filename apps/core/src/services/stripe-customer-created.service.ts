import * as Sentry from "@sentry/node";
import { ensureInitialLocalFreeSubscriptionPeriod } from "@sokosumi/database/helpers";
import type Stripe from "stripe";

import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

function reportMissingStripeCustomerOwner(params: {
  customerId: string;
  ownerId: string;
  ownerType: "organization" | "user";
  error: unknown;
}): void {
  Sentry.captureException(params.error, {
    level: "warning",
    tags: {
      context: "stripe_customer_created",
      reason: "owner_missing",
      ownerType: params.ownerType,
    },
    extra: {
      customerId: params.customerId,
      ownerId: params.ownerId,
    },
  });
  console.warn(
    `Skipping Stripe customer ${params.customerId} write-back: ${params.ownerType} ${params.ownerId} no longer exists`,
  );
}

/**
 * Writes the Stripe customer id back to the user/organization and seeds the
 * initial local free subscription period.
 *
 * Missing owners (P2025) are soft-acked: org/user deletion after Stripe
 * customer creation is irreversible, so rethrowing would only cause Stripe
 * retries and Sentry noise.
 */
export async function handleCustomerCreatedEvent(
  customer: Stripe.Customer,
): Promise<void> {
  const metadata = customer.metadata;
  switch (metadata?.customerType) {
    case "user": {
      const userId = metadata.userId;
      if (!userId) {
        console.warn(
          `Skipping Stripe customer ${customer.id} write-back: missing userId metadata`,
        );
        break;
      }

      let user: { createdAt: Date };
      try {
        user = await prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customer.id },
        });
      } catch (error) {
        if (isPrismaRecordNotFoundError(error)) {
          reportMissingStripeCustomerOwner({
            customerId: customer.id,
            ownerId: userId,
            ownerType: "user",
            error,
          });
          break;
        }
        throw error;
      }

      console.log(`✅ Set user ${userId} stripe customer id to ${customer.id}`);

      await prisma.$transaction(async (tx) => {
        await ensureInitialLocalFreeSubscriptionPeriod(
          {
            createdAt: user.createdAt,
            kind: "user",
            stripeCustomerId: customer.id,
            userId,
          },
          tx,
        );
      });
      break;
    }
    case "organization": {
      const organizationId = metadata.organizationId;
      if (!organizationId) {
        console.warn(
          `Skipping Stripe customer ${customer.id} write-back: missing organizationId metadata`,
        );
        break;
      }

      let organization: { createdAt: Date };
      try {
        organization = await prisma.organization.update({
          where: { id: organizationId },
          data: { stripeCustomerId: customer.id },
        });
      } catch (error) {
        if (isPrismaRecordNotFoundError(error)) {
          reportMissingStripeCustomerOwner({
            customerId: customer.id,
            ownerId: organizationId,
            ownerType: "organization",
            error,
          });
          break;
        }
        throw error;
      }

      console.log(
        `✅ Set organization ${organizationId} stripe customer id to ${customer.id}`,
      );

      await prisma.$transaction(async (tx) => {
        await ensureInitialLocalFreeSubscriptionPeriod(
          {
            createdAt: organization.createdAt,
            kind: "organization",
            organizationId,
            stripeCustomerId: customer.id,
          },
          tx,
        );
      });
      break;
    }
    default: {
      console.log(`Unknown customer type ${metadata?.customerType}`);
      break;
    }
  }
}
