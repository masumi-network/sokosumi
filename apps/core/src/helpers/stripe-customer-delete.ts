import { stripeClient } from "@/clients/stripe.client";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";

const STRIPE_CUSTOMER_DELETE_TIMEOUT_MS = 2500;

const RUNNING_STRIPE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
] as const;

interface DeleteStripeCustomerBestEffortInput {
  stripeCustomerId: string | null | undefined;
  ownerType: "user" | "organization";
  ownerId: string;
}

function isStripeResourceMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === "resource_missing"
  );
}

/**
 * Best-effort Stripe customer delete after User or Organization deletion is
 * allowed. Failure is logged and must not fail the wipe. Never cancels a
 * subscription — `customers.del` would cancel active Stripe subscriptions, so
 * a still-running local subscription skips delete until evaluate blocks that
 * case (SOK-843/844).
 */
export async function deleteStripeCustomerBestEffort(
  input: DeleteStripeCustomerBestEffortInput,
): Promise<void> {
  if (!input.stripeCustomerId) {
    return;
  }

  const runningSubscription = await prisma.subscription.findFirst({
    where: {
      referenceId: input.ownerId,
      stripeSubscriptionId: { not: null },
      status: { in: [...RUNNING_STRIPE_SUBSCRIPTION_STATUSES] },
    },
    select: { id: true },
  });
  if (runningSubscription) {
    console.warn(
      `Skipping Stripe customer ${input.stripeCustomerId} delete: running subscription still present for ${input.ownerType} ${input.ownerId}`,
    );
    return;
  }

  try {
    await stripeClient.deleteCustomer(input.stripeCustomerId, {
      timeout: STRIPE_CUSTOMER_DELETE_TIMEOUT_MS,
    });
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return;
    }

    captureExternalServiceError(error, {
      label: "stripe_customer_delete",
      sentry: {
        tags: {
          context: "stripe_customer_delete",
          ownerType: input.ownerType,
        },
      },
      extra: {
        ownerId: input.ownerId,
        stripeCustomerId: input.stripeCustomerId,
      },
    });
  }
}
