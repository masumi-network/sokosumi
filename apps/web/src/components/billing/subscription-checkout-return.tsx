import { PurchaseTracker } from "@/components/billing/purchase-tracker";
import { coreClient } from "@/lib/clients/core.client";
import { isStripeCheckoutSessionId } from "@/lib/stripe/subscription-redirect-urls";

interface SubscriptionCheckoutReturnProps {
  sessionId?: string;
}

/**
 * Fires GA4 `purchase` for a subscription checkout. Stripe → Better Auth's
 * `/subscription/success` hop → `/billing?…&status=success&checkout_session_id=cs_…`.
 * The success modal stays with SubscriptionSuccessModal; this only tracks.
 */
export async function SubscriptionCheckoutReturn({
  sessionId,
}: SubscriptionCheckoutReturnProps) {
  if (!isStripeCheckoutSessionId(sessionId)) {
    return null;
  }

  const checkoutSession = await coreClient
    .getCheckoutSessionAnalytics(sessionId)
    .then((response) => response.data)
    .catch(() => null);

  return checkoutSession ? (
    <PurchaseTracker checkoutSession={checkoutSession} />
  ) : null;
}
