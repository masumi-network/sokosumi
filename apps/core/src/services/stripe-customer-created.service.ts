import { ensureInitialLocalFreeSubscriptionPeriod } from "@sokosumi/database/helpers";
import type Stripe from "stripe";

import prisma from "@/lib/db/prisma";

/**
 * Writes the Stripe customer id back to the user/organization and seeds the
 * initial local free subscription period.
 */
export async function handleCustomerCreatedEvent(
  customer: Stripe.Customer,
): Promise<void> {
  const metadata = customer.metadata;
  switch (metadata?.customerType) {
    case "user": {
      const userId = metadata.userId;
      const user = await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
      });
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
      const organization = await prisma.organization.update({
        where: { id: metadata.organizationId },
        data: { stripeCustomerId: customer.id },
      });
      console.log(
        `✅ Set organization ${metadata.organizationId} stripe customer id to ${customer.id}`,
      );

      await prisma.$transaction(async (tx) => {
        await ensureInitialLocalFreeSubscriptionPeriod(
          {
            createdAt: organization.createdAt,
            kind: "organization",
            organizationId: metadata.organizationId,
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
