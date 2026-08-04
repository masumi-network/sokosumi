import { CreditsCancelModal } from "@/components/billing/credits-cancel-modal";
import { CreditsPurchaseSuccess } from "@/components/billing/credits-purchase-success";
import { PurchaseTracker } from "@/components/billing/purchase-tracker";
import { coreClient } from "@/lib/clients/core.client";
import type { CoworkerOption } from "@/lib/types/coworker";

interface CreditsCheckoutReturnProps {
  coworkersPromise: Promise<CoworkerOption[]>;
  cancel?: string;
  sessionId?: string;
}

/**
 * Stripe credits/coupon return UI. Rendered once as a sibling of BillingTabs
 * (or on standalone /coupon) so tab unmount cannot remount the success modal
 * or re-fire purchase analytics.
 */
export async function CreditsCheckoutReturn({
  coworkersPromise,
  cancel,
  sessionId,
}: CreditsCheckoutReturnProps) {
  if (!sessionId && !cancel) {
    return null;
  }

  const checkoutSession = sessionId
    ? await coreClient
        .getCheckoutSessionAnalytics(sessionId)
        .then((response) => response.data)
        .catch(() => null)
    : null;

  return (
    <>
      {checkoutSession ? (
        <>
          <CreditsPurchaseSuccess
            coworkersPromise={coworkersPromise}
            initialOpen
          />
          <PurchaseTracker checkoutSession={checkoutSession} />
        </>
      ) : null}
      {cancel ? <CreditsCancelModal /> : null}
    </>
  );
}
