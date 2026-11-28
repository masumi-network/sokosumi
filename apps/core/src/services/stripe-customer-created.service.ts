import { ensureInitialLocalFreeSubscriptionPeriod } from "@sokosumi/database/helpers";
import type Stripe from "stripe";

import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
import { grantLocalFreePeriods } from "@/lib/credits/grant";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";

const SKIPPED_WRITE_BACK =
  "Skipped writing a Stripe customer id back to its owner";

/** On the Stripe webhook's request event while it is live. */
function warnSkippedWriteBack(
  customer: Stripe.Customer,
  why: string,
  owner?: { id: string; type: "organization" | "user" },
): void {
  recordCoreWarning(
    { operation: "stripe_customer_created" },
    { message: SKIPPED_WRITE_BACK, why },
    {
      stripeCustomer: {
        id: customer.id,
        customerType: customer.metadata?.customerType,
      },
      ...(owner ? { owner } : {}),
    },
  );
}

function warnMissingStripeCustomerOwner(
  customer: Stripe.Customer,
  owner: { id: string; type: "organization" | "user" },
): void {
  // Soft-ack only: captureException kept SOKOSUMI-CORE-2V unresolved.
  warnSkippedWriteBack(
    customer,
    owner.type === "user"
      ? "The user no longer exists"
      : "The organization no longer exists",
    owner,
  );
}

/**
 * Writes the Stripe customer id back to the user/organization. For an
 * organization it also seeds the initial local free subscription period, as a
 * fallback to the seed at organization creation. A user's free plan starts with
 * their personal workspace (createPersonalWorkspace), never here.
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
        warnSkippedWriteBack(customer, "The customer's metadata has no userId");
        break;
      }

      try {
        await prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customer.id },
        });
      } catch (error) {
        if (isPrismaRecordNotFoundError(error)) {
          warnMissingStripeCustomerOwner(customer, {
            id: userId,
            type: "user",
          });
          break;
        }
        throw error;
      }
      break;
    }
    case "organization": {
      const organizationId = metadata.organizationId;
      if (!organizationId) {
        warnSkippedWriteBack(
          customer,
          "The customer's metadata has no organizationId",
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
          warnMissingStripeCustomerOwner(customer, {
            id: organizationId,
            type: "organization",
          });
          break;
        }
        throw error;
      }

      await prisma.$transaction(async (tx) => {
        await ensureInitialLocalFreeSubscriptionPeriod(
          {
            createdAt: organization.createdAt,
            // The free plan's credits are Mainnet's.
            grantCredits: grantLocalFreePeriods(
              createNetworkScope("mainnet"),
              tx,
            ),
            kind: "organization",
            organizationId,
            stripeCustomerId: customer.id,
          },
          tx,
        );
      });
      break;
    }
  }
}
