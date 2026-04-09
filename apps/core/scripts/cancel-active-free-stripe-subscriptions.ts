import "dotenv/config";

import { FREE_SUBSCRIPTION_PLAN } from "@sokosumi/database/helpers";

import { stripeClient } from "../src/clients/stripe.client.js";
import prisma from "../src/lib/db/prisma.js";

async function main(): Promise<void> {
  const activeStripeFreeSubscriptions = await prisma.subscription.findMany({
    where: {
      NOT: {
        cancelAtPeriodEnd: true,
      },
      plan: FREE_SUBSCRIPTION_PLAN,
      periodEnd: {
        gt: new Date(),
      },
      stripeSubscriptionId: {
        not: null,
      },
    },
    orderBy: [{ periodEnd: "asc" }, { updatedAt: "asc" }],
    select: {
      id: true,
      periodEnd: true,
      stripeSubscriptionId: true,
    },
  });

  let failed = 0;
  let updated = 0;

  for (const subscription of activeStripeFreeSubscriptions) {
    if (!subscription.stripeSubscriptionId) {
      continue;
    }

    try {
      await stripeClient.updateSubscriptionCancelAtPeriodEnd(
        subscription.stripeSubscriptionId,
        true,
      );

      await prisma.subscription.update({
        where: {
          id: subscription.id,
        },
        data: {
          cancelAt: subscription.periodEnd,
          cancelAtPeriodEnd: true,
        },
      });

      updated += 1;
      console.log(
        `Scheduled Stripe-backed free subscription ${subscription.id} to cancel at period end`,
      );
    } catch (error) {
      failed += 1;
      console.error(
        `Failed to schedule Stripe-backed free subscription ${subscription.id}:`,
        error,
      );
    }
  }

  console.log(
    `Finished scheduling Stripe-backed free subscriptions: ${updated} updated, ${failed} failed`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
