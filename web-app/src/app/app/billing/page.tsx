import BillingForm from "@/components/billing/billing-form";
import { getEnvSecrets } from "@/config/env.config";
import { getCostPerCredit } from "@/lib/actions/stripe.actions";

export default async function BillingPage() {
  const priceId = getEnvSecrets().STRIPE_PRICE_ID;
  const costPerCredit = await getCostPerCredit(priceId);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <BillingForm
        priceId={priceId}
        amountPerCredit={costPerCredit.amountPerCredit}
        currency={costPerCredit.currency}
      />
    </div>
  );
}
