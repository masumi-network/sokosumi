import { getTranslations } from "next-intl/server";

import BillingForm from "@/components/billing/billing-form";
import { getEnvSecrets } from "@/config/env.secrets";
import { stripeClient } from "@/lib/clients";
import { agentService, userService } from "@/lib/services";

import BillingCancelModal from "./components/cancel-modal";
import BillingSuccessModal from "./components/success-modal";

interface BillingPageProps {
  searchParams: Promise<{
    session_id?: string;
    cancel?: string;
  }>;
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const t = await getTranslations("App.Billing");
  const { session_id, cancel } = await searchParams;

  const productId = getEnvSecrets().STRIPE_PRODUCT_ID;
  const price = await stripeClient.getPriceByProductId(productId);
  const activeOrganization = await userService.getActiveOrganization();

  // for billing success modal
  const checkoutSessionPromise = session_id
    ? stripeClient.getCheckoutSessionData(session_id)
    : null;
  const randomAgentPromise = agentService.getRandomAvailableAgentData();

  return (
    <div className="w-full space-y-12 px-2">
      <div className="space-y-2">
        <h1 className="text-2xl font-light md:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <div className="max-w-3xl">
        <BillingForm price={price} organization={activeOrganization} />
        {checkoutSessionPromise && (
          <BillingSuccessModal
            checkoutSessionPromise={checkoutSessionPromise}
            randomAgentPromise={randomAgentPromise}
          />
        )}
        {cancel && <BillingCancelModal />}
      </div>
    </div>
  );
}
