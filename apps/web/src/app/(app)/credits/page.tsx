import Link from "next/link";
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
    <div className="w-full space-y-12 px-2">
      <div className="space-y-1">
        <h1 className="text-2xl font-light md:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
        <Link
          href="https://billing.stripe.com/p/login/00w28r02bac4cNR8mDgIo00"
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
          className="text-primary text-sm font-medium underline-offset-4 hover:underline"
        >
          {t("billingPortalCta")}
        </Link>
      </div>
      <div className="max-w-3xl">
        <CreditsForm price={price} organization={activeOrganization} />
        {checkoutSessionPromise && (
          <CreditsSuccessModal
            checkoutSessionPromise={checkoutSessionPromise}
            randomAgentPromise={randomAgentPromise}
          />
        )}
        {cancel && <CreditsCancelModal />}
      </div>
    </div>
  );
}
