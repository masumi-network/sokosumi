import CreditsCancelModal from "@/app/credits/components/cancel-modal";
import { CreditsPurchaseSuccess } from "@/app/credits/components/credits-purchase-success";
import PurchaseTracker from "@/app/credits/components/purchase-tracker";
import { getFeaturedCoworkers } from "@/components/billing/get-featured-coworkers";
import CouponForm from "@/components/credits/coupon-form";
import { coreClient } from "@/lib/clients/core.client";
import type { Organization } from "@/lib/clients/generated/core";

interface CouponSectionProps {
  organization: Organization | null;
  returnPath?: string;
  searchParams?: {
    cancel?: string;
    session_id?: string;
  };
}

export default async function CouponSection({
  organization,
  returnPath,
  searchParams,
}: CouponSectionProps) {
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
      <CouponForm organization={organization} returnPath={returnPath} />
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
