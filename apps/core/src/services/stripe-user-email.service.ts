import { userRepository } from "@sokosumi/database/repositories";

import { stripeClient } from "@/clients/stripe.client";
import prisma from "@/lib/db/prisma";

export async function syncUserEmailWithStripe(
  userId: string,
  newEmail: string,
): Promise<boolean> {
  try {
    const user = await userRepository.getUserById(userId, prisma);

    if (!user?.stripeCustomerId) {
      return true;
    }

    await stripeClient.updateCustomerEmail(user.stripeCustomerId, newEmail);

    console.log(
      `✅ Synced user ${userId} email to Stripe customer ${user.stripeCustomerId}`,
    );

    return true;
  } catch (error) {
    console.error(
      `Error syncing user email with Stripe for user ${userId}:`,
      error,
    );
    return false;
  }
}
