import BillingForm from "@/components/billing/billing-form";
import { getEnvSecrets } from "@/config/env.config";
import { getCostPerCredit } from "@/lib/actions/stripe.actions";
import { requireAuthentication } from "@/lib/auth/utils";

export default async function BillingPage() {
  const priceId = getEnvSecrets().STRIPE_PRICE_ID;
  const costPerCredit = await getCostPerCredit(priceId);
  const { session } = await requireAuthentication();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <BillingForm
        userId={session.user.id}
        priceId={priceId}
        amountPerCredit={costPerCredit.amountPerCredit}
        currency={costPerCredit.currency}
      />
    </div>
  );
}
