import { Coins } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { resolveLowCreditsBillingPath } from "@/app/components/account-notice-state";
import BuyCreditsButton from "./buy-credits-button";

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
      icon={<Coins className="size-4 shrink-0" aria-hidden />}
    />
  );
}
