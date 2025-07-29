import BillingForm from "@/components/billing/billing-form";
import { getEnvSecrets } from "@/config/env.secrets";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { getActiveOrganization, getPriceFromProductId } from "@/lib/services";

export default async function BillingPage() {
  await getSessionOrRedirect();

  const productId = getEnvSecrets().STRIPE_PRODUCT_ID;
  const price = await getPriceFromProductId(productId);
  const activeOrganization = await getActiveOrganization();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <BillingForm price={price} organization={activeOrganization} />
    </div>
  );
}
