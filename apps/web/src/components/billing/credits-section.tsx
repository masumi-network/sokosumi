import CreditsForm from "@/components/credits/credits-form";
import type {
  CreditTopUpPricing,
  Organization,
} from "@/lib/clients/generated/core";

interface CreditsSectionProps {
  isPurchaseEnabled?: boolean;
  organization: Organization | null;
  // Provided by the billing page, which already fetches the catalog to gate
  // free-plan purchases — avoids a second identical Core round-trip per render.
  pricing: CreditTopUpPricing;
  returnPath?: string;
}

export default async function CreditsSection({
  isPurchaseEnabled = true,
  organization,
  pricing,
  returnPath,
}: CreditsSectionProps) {
  return (
    <CreditsForm
      isPurchaseEnabled={isPurchaseEnabled}
      pricing={pricing}
      organization={organization}
      returnPath={returnPath}
    />
  );
}
