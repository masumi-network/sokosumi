import { notFound } from "next/navigation";

import CreditsSection from "@/components/billing/credits-section";
import { zeroMarginTopUpEnabled } from "@/lib/flags/zero-margin-top-up";
import { userService } from "@/lib/services";
import { ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY } from "@/lib/stripe/credit-topup-pricing";

interface SecretTopUpPageProps {
  searchParams: Promise<{
    cancel?: string;
    session_id?: string;
  }>;
}

export default async function SecretTopUpPage({
  searchParams,
}: SecretTopUpPageProps) {
  if (!(await zeroMarginTopUpEnabled())) {
    notFound();
  }

  const { cancel, session_id } = await searchParams;
  const activeOrganization = await userService.getActiveOrganization();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <CreditsSection
          organization={activeOrganization}
          priceLookupKeyOverride={ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY}
          returnPath="/billing/top-up"
          searchParams={{ cancel, session_id }}
        />
      </div>
    </div>
  );
}
