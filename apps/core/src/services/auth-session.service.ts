import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import { stripeClient } from "@/clients/stripe.client";
import prisma from "@/lib/db/prisma";

/**
 * Auth-instance hook bodies ported from the web app:
 *
 * - `resolveActiveOrganizationIdForSession` — web's
 *   `preferredOrganizationService.resolveActiveOrganizationIdForSession`,
 *   runs in the `session.create.before` database hook to restore the user's
 *   preferred workspace (membership re-validated; stale preferences fall back
 *   to the personal workspace).
 * - `syncUserEmailWithStripe` — web's `stripeService.syncUserEmailWithStripe`,
 *   fire-and-forget from the `/verify-email` after-hook when the user has a
 *   Stripe customer.
 */
export const authSessionService = (() => {
  async function resolveActiveOrganizationIdForSession(
    userId: string,
  ): Promise<string | null> {
    const user = await userRepository.getUserById(userId, prisma);
    const preferredOrganizationId = user?.preferredOrganizationId ?? null;

    if (!preferredOrganizationId) {
      return null;
    }

    const member = await memberRepository.getMemberByUserIdAndOrganizationId(
      userId,
      preferredOrganizationId,
      prisma,
    );

    return member ? preferredOrganizationId : null;
  }

  async function syncUserEmailWithStripe(
    userId: string,
    newEmail: string,
  ): Promise<boolean> {
    try {
      const user = await userRepository.getUserById(userId, prisma);

      if (!user || !user.stripeCustomerId) {
        // No Stripe customer to update
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

  return {
    resolveActiveOrganizationIdForSession,
    syncUserEmailWithStripe,
  };
})();
