import type { Prisma, Subscription } from "../generated/prisma/client.js";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "../helpers/subscription.js";

export const subscriptionRepository = {
  async getSubscriptionByStripeSubscriptionId(
    stripeSubscriptionId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Subscription | null> {
    return await tx.subscription.findFirst({
      where: {
        stripeSubscriptionId,
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  },

  async getLatestSubscriptionByReferenceId(
    referenceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Subscription | null> {
    return await tx.subscription.findFirst({
      where: {
        referenceId,
      },
      orderBy: [{ periodEnd: "desc" }, { updatedAt: "desc" }],
    });
  },

  async getLatestActiveSubscriptionByReferenceId(
    referenceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Subscription | null> {
    return await tx.subscription.findFirst({
      where: {
        referenceId,
        status: {
          in: [...ACTIVE_SUBSCRIPTION_STATUSES],
        },
      },
      orderBy: [{ periodEnd: "desc" }, { updatedAt: "desc" }],
    });
  },
};
