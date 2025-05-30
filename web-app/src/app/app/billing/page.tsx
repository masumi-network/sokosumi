import { redirect } from "next/navigation";

import BillingForm from "@/components/billing/billing-form";
import { getEnvSecrets } from "@/config/env.config";
import { getConversionFactors } from "@/lib/actions";
import { getSession } from "@/lib/auth/utils";

export default async function BillingPage() {
  const priceId = getEnvSecrets().STRIPE_PRICE_ID;
  const conversionFactors = await getConversionFactors(priceId);
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <BillingForm
        userId={session.user.id}
        priceId={priceId}
        amountPerCredit={conversionFactors.amountPerCredit}
        currency={conversionFactors.currency}
      />
    </div>
  );
}
