import CreditsCancelModal from "@/app/credits/components/cancel-modal";
import PurchaseTracker from "@/app/credits/components/purchase-tracker";
import CreditsSuccessModal from "@/app/credits/components/success-modal";
import CouponForm from "@/components/credits/coupon-form";
import { coreClient } from "@/lib/clients/core.client";
import type { Organization } from "@/lib/clients/generated/core";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services";

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

  const randomAgentPromise = agentService.getRandomAvailableAgentData();
  const projectOptionsPromise = getProjectFilterOptions();
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
        <CreditsSuccessModal
          randomAgentPromise={randomAgentPromise}
          projectOptionsPromise={projectOptionsPromise}
        />
      ) : null}
      {checkoutSession ? (
        <PurchaseTracker checkoutSession={checkoutSession} />
      ) : null}
      {cancel ? <CreditsCancelModal /> : null}
    </>
  );
}
