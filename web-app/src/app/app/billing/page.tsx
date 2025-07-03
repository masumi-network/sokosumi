import BillingForm from "@/components/billing/billing-form";
import OrganizationBillingForm from "@/components/billing/organization-billing-form";
import { getEnvSecrets } from "@/config/env.secrets";
import { getActiveOrganization, getConversionFactors } from "@/lib/services";

export default async function BillingPage() {
  const priceId = getEnvSecrets().STRIPE_PRICE_ID;
  const conversionFactors = await getConversionFactors(priceId);
  const activeOrganization = await getActiveOrganization();

  // Use organization billing form if user has an active organization
  if (activeOrganization) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <OrganizationBillingForm
          priceId={priceId}
          amountPerCredit={conversionFactors.amountPerCredit}
          currency={conversionFactors.currency}
          organization={activeOrganization}
        />
      </div>
    );
  }

  // Otherwise use regular billing form
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
