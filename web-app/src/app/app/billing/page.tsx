import BillingForm from "@/components/billing/billing-form";
import { getEnvSecrets } from "@/config/env.config";
import { getConversionFactors } from "@/lib/services";

export default async function BillingPage() {
  const priceId = getEnvSecrets().STRIPE_PRICE_ID;
  const conversionFactors = await getConversionFactors(priceId);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <BillingForm
        priceId={priceId}
        amountPerCredit={conversionFactors.amountPerCredit}
        currency={conversionFactors.currency}
      />
    </div>
  );
}
