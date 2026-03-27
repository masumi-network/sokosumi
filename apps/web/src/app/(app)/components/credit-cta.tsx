import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import BuyCreditsButton from "./buy-credits-button";
import { resolveLowCreditsBillingPath } from "./top-notice-state";

interface CreditCtaProps {
  currentPlan: string | null;
}

export default async function CreditCta({ currentPlan }: CreditCtaProps) {
  const tPlan = await getTranslations("App.Header.Plan");
  const billingPath = resolveLowCreditsBillingPath(currentPlan);

  return (
    <BuyCreditsButton
      label={tPlan("getMoreCredits")}
      path={billingPath}
      iconRight={<ArrowUpRight aria-hidden />}
    />
  );
}
