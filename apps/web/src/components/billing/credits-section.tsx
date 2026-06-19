import CreditsCancelModal from "@/app/credits/components/cancel-modal";
import PurchaseTracker from "@/app/credits/components/purchase-tracker";
import CreditsSuccessModal from "@/app/credits/components/success-modal";
import CreditsForm from "@/components/credits/credits-form";
import { coreClient } from "@/lib/clients/core.client";
import type {
  CreditTopUpPricing,
  Organization,
} from "@/lib/clients/generated/core";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services";

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
      <CreditsForm
        isPurchaseEnabled={isPurchaseEnabled}
        pricing={pricing}
        organization={organization}
        returnPath={returnPath}
      />
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
