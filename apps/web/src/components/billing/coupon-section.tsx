import CreditsCancelModal from "@/app/credits/components/cancel-modal";
import { CreditsPurchaseSuccess } from "@/app/credits/components/credits-purchase-success";
import PurchaseTracker from "@/app/credits/components/purchase-tracker";
import CouponForm from "@/components/credits/coupon-form";
import { coreClient } from "@/lib/clients/core.client";
import type { Organization } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

interface CouponSectionProps {
  // Provided by the billing page, which creates it once and shares it across
  // the credits/coupon/subscription tabs — avoids fetching coworkers 3x per render.
  coworkersPromise: Promise<CoworkerOption[]>;
  organization: Organization | null;
  returnPath?: string;
  searchParams?: {
    cancel?: string;
    session_id?: string;
  };
}

export default async function CouponSection({
  coworkersPromise,
  organization,
  returnPath,
  searchParams,
}: CouponSectionProps) {
  const sessionId = searchParams?.session_id;
  const cancel = searchParams?.cancel;

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
