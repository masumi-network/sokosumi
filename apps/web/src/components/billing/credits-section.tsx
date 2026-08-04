import CreditsCancelModal from "@/app/credits/components/cancel-modal";
import { CreditsPurchaseSuccess } from "@/app/credits/components/credits-purchase-success";
import PurchaseTracker from "@/app/credits/components/purchase-tracker";
import { getFeaturedCoworkers } from "@/components/billing/get-featured-coworkers";
import CreditsForm from "@/components/credits/credits-form";
import { coreClient } from "@/lib/clients/core.client";
import type {
  CreditTopUpPricing,
  Organization,
} from "@/lib/clients/generated/core";

interface CreditsSectionProps {
  isPurchaseEnabled?: boolean;
  organization: Organization | null;
  // Provided by the billing page, which already fetches the catalog to gate
  // free-plan purchases — avoids a second identical Core round-trip per render.
  pricing: CreditTopUpPricing;
  returnPath?: string;
  searchParams?: {
    cancel?: string;
    session_id?: string;
  };
}

export default async function CreditsSection({
  isPurchaseEnabled = true,
  organization,
  pricing,
  returnPath,
  searchParams,
}: CreditsSectionProps) {
  const sessionId = searchParams?.session_id;
  const cancel = searchParams?.cancel;

  const coworkersPromise = getFeaturedCoworkers();
  const checkoutSession = sessionId
    ? await coreClient
        .getCheckoutSessionAnalytics(sessionId)
        .then((response) => response.data)
        .catch(() => null)
    : null;

  return (
    <>
      <CreditsForm
        isPurchaseEnabled={isPurchaseEnabled}
        pricing={pricing}
        organization={organization}
        returnPath={returnPath}
      />
      {sessionId ? (
        <CreditsPurchaseSuccess coworkersPromise={coworkersPromise} />
      ) : null}
      {checkoutSession ? (
        <PurchaseTracker checkoutSession={checkoutSession} />
      ) : null}
      {cancel ? <CreditsCancelModal /> : null}
    </>
  );
}
