import { stripeClient } from "@/clients/stripe.client";
import { captureExternalServiceError } from "@/lib/external-service-errors";

interface DeleteStripeCustomerBestEffortInput {
  stripeCustomerId: string | null | undefined;
  ownerType: "user" | "organization";
  ownerId: string;
}

/**
 * Best-effort Stripe customer delete after User or Organization deletion is
 * allowed. Failure is logged and must not fail the wipe. Never cancels a
 * subscription — running subscriptions are a deletion blocker, not a cancel.
 */
export async function deleteStripeCustomerBestEffort(
  input: DeleteStripeCustomerBestEffortInput,
): Promise<void> {
  if (!input.stripeCustomerId) {
    return;
  }

  try {
    await stripeClient.deleteCustomer(input.stripeCustomerId);
  } catch (error) {
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
