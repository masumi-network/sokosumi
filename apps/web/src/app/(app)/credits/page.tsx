import { getTranslations } from "next-intl/server";

import CreditsForm from "@/components/credits/credits-form";
import { getEnvSecrets } from "@/config/env.secrets";
import { stripeClient } from "@/lib/clients";
import { agentService, userService } from "@/lib/services";

import CreditsCancelModal from "./components/cancel-modal";
import CreditsSuccessModal from "./components/success-modal";

interface CreditsPageProps {
  searchParams: Promise<{
    session_id?: string;
    cancel?: string;
  }>;
}

export default async function CreditsPage({ searchParams }: CreditsPageProps) {
  const t = await getTranslations("App.Credits");
  const { session_id, cancel } = await searchParams;

  const productId = getEnvSecrets().STRIPE_PRODUCT_ID;
  const price = await stripeClient.getPriceByProductId(productId);
  const activeOrganization = await userService.getActiveOrganization();

  // for credits success modal
  const checkoutSessionPromise = session_id
    ? stripeClient.getCheckoutSessionData(session_id)
    : null;
  const randomAgentPromise = agentService.getRandomAvailableAgentData();

  return (
    <div className="mx-auto max-w-3xl space-y-6 md:p-6">
      <h1 className="text-2xl font-light">{t("title")}</h1>
      <CreditsForm price={price} organization={activeOrganization} />
      {checkoutSessionPromise && (
        <CreditsSuccessModal
          checkoutSessionPromise={checkoutSessionPromise}
          randomAgentPromise={randomAgentPromise}
        />
      )}
      {cancel && <CreditsCancelModal />}
    </div>
  );
}
