import { getTranslations } from "next-intl/server";

import BillingForm from "@/components/billing/billing-form";
import { getEnvSecrets } from "@/config/env.secrets";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { stripeClient } from "@/lib/clients/stripe.client";
import { userService } from "@/lib/services";

export default async function BillingPage() {
  await getSessionOrRedirect();
  const t = await getTranslations("App.Billing");

  const productId = getEnvSecrets().STRIPE_PRODUCT_ID;
  const price = await stripeClient.getPriceByProductId(productId);
  const activeOrganization = await userService.getActiveOrganization();

  return (
    <div className="mx-auto max-w-3xl space-y-6 md:p-6">
      <h1 className="text-2xl font-light">{t("title")}</h1>
      <BillingForm price={price} organization={activeOrganization} />
    </div>
  );
}
