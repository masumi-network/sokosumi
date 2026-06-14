import * as Sentry from "@sentry/node";
import { userRepository } from "@sokosumi/database/repositories";

import { stripeClient } from "@/clients/stripe.client";
import prisma from "@/lib/db/prisma";

export async function syncUserEmailWithStripe(
  userId: string,
  newEmail: string,
): Promise<void> {
  try {
    const user = await userRepository.getUserById(userId, prisma);

    if (!user?.stripeCustomerId) {
      return;
    }

    await stripeClient.updateCustomerEmail(user.stripeCustomerId, newEmail);
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        context: "stripe_user_email_sync",
      },
      extra: {
        userId,
      },
    });
  }
}
