import BillingForm from "@/components/billing/billing-form";
import { getCostPerCredit } from "@/lib/actions/stripe.actions";

export default async function BillingPage() {
  const costPerCredit = await getCostPerCredit();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <BillingForm
        amountPerCredit={costPerCredit.amountPerCredit}
        currency={costPerCredit.currency}
      />
    </div>
  );
}
