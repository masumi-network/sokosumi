import Link from "next/link";
import { getTranslations } from "next-intl/server";

import CreditsForm from "@/components/credits/credits-form";
import { getEnvSecrets } from "@/config/env.secrets";
import { stripeClient } from "@/lib/clients";
import { agentService, userService } from "@/lib/services";

import CreditsCancelModal from "./components/cancel-modal";
import PurchaseTracker from "./components/purchase-tracker";
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

  const productId = getEnvSecrets().STRIPE_CREDIT_PRODUCT_ID;
  const price = await stripeClient.getPriceByProductId(productId);
  const activeOrganization = await userService.getActiveOrganization();

  const randomAgentPromise = agentService.getRandomAvailableAgentData();

  const checkoutSession = session_id
    ? await stripeClient.getCheckoutSession(session_id).catch(() => null)
    : null;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <div className="space-y-1">
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
        <div>
          <CreditsForm price={price} organization={activeOrganization} />
          {session_id && (
            <CreditsSuccessModal randomAgentPromise={randomAgentPromise} />
          )}
          {checkoutSession && (
            <PurchaseTracker checkoutSession={checkoutSession} />
          )}
          {cancel && <CreditsCancelModal />}
        </div>
      </div>
    </div>
  );
}
