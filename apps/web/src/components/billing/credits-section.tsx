import type { CreditTopUpLookupKey } from "@sokosumi/utils";
import CreditsCancelModal from "@/app/credits/components/cancel-modal";
import PurchaseTracker from "@/app/credits/components/purchase-tracker";
import CreditsSuccessModal from "@/app/credits/components/success-modal";
import CreditsForm from "@/components/credits/credits-form";
import { coreClient } from "@/lib/clients/core.client";
import type { Organization } from "@/lib/clients/generated/core";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services";

interface CreditsSectionProps {
  isPurchaseEnabled?: boolean;
  organization: Organization | null;
  priceLookupKeyOverride?: CreditTopUpLookupKey;
  returnPath?: string;
  searchParams?: {
    cancel?: string;
    session_id?: string;
  };
}

export default async function CreditsSection({
  isPurchaseEnabled = true,
  organization,
  priceLookupKeyOverride,
  returnPath,
  searchParams,
}: CreditsSectionProps) {
  const sessionId = searchParams?.session_id;
  const cancel = searchParams?.cancel;

  const { data: priceCatalog } = await coreClient.getCreditTopUpPriceCatalog(
    priceLookupKeyOverride,
  );
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
        priceLookupKeyOverride={priceLookupKeyOverride}
        priceCatalog={priceCatalog}
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
