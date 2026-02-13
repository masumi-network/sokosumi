import { Organization } from "@sokosumi/database";

import CreditsCancelModal from "@/app/credits/components/cancel-modal";
import PurchaseTracker from "@/app/credits/components/purchase-tracker";
import CreditsSuccessModal from "@/app/credits/components/success-modal";
import CreditsForm from "@/components/credits/credits-form";
import { stripeClient } from "@/lib/clients";
import { agentService } from "@/lib/services";

interface CreditsSectionProps {
  isPurchaseEnabled?: boolean;
  organization: Organization | null;
  returnPath?: string;
  searchParams?: {
    cancel?: string;
    session_id?: string;
  };
}

export default async function CreditsSection({
  isPurchaseEnabled = true,
  organization,
  returnPath,
  searchParams,
}: CreditsSectionProps) {
  const sessionId = searchParams?.session_id;
  const cancel = searchParams?.cancel;

  const priceCatalog = await stripeClient.getCreditTopUpPriceCatalog();
  const randomAgentPromise = agentService.getRandomAvailableAgentData();
  const checkoutSession = sessionId
    ? await stripeClient.getCheckoutSession(sessionId).catch(() => null)
    : null;

  return (
    <>
      <CreditsForm
        isPurchaseEnabled={isPurchaseEnabled}
        priceCatalog={priceCatalog}
        organization={organization}
        returnPath={returnPath}
      />
      {sessionId ? (
        <CreditsSuccessModal randomAgentPromise={randomAgentPromise} />
      ) : null}
      {checkoutSession ? (
        <PurchaseTracker checkoutSession={checkoutSession} />
      ) : null}
      {cancel ? <CreditsCancelModal /> : null}
    </>
  );
}
