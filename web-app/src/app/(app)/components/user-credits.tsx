import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { convertCentsToCredits } from "@/lib/db";
import { creditTransactionRepository } from "@/lib/db/repositories";
import { stripeService } from "@/lib/services";
import { userService } from "@/lib/services/user.service";

import BuyCreditsButton from "./buy-credits-button";
import FreeCreditsButton from "./free-credits-button";
import UserAvatar from "./user-avatar";

export default async function UserCredits() {
  const user = await userService.getMe();
  if (!user) {
    redirect("/login");
  }

  const t = await getTranslations("App.Header.Credit");

  if (!user) {
    return (
      <div className="text-muted-foreground text-sm">{t("unavailable")}</div>
    );
  }

  // Check for active organization
  const activeOrganization = await userService.getActiveOrganization();

  // Get appropriate credits based on context
  let credits: number;
  let creditLabel: string;

  if (activeOrganization) {
    const cents = await creditTransactionRepository.getCentsByOrganizationId(
      activeOrganization.id,
    );
    credits = convertCentsToCredits(cents);
    creditLabel = t("organizationBalance", {
      credits: credits,
      organization: activeOrganization.name,
    });
  } else {
    const cents = await creditTransactionRepository.getCentsByUserId(user.id);
    credits = convertCentsToCredits(cents);
    creditLabel = t("userBalance", { credits: credits });
  }

  const promotionCode = await stripeService.getWelcomePromotionCode();

  return (
    <div className="flex flex-1 flex-col-reverse gap-4 md:flex-initial md:flex-row md:items-center">
      {promotionCode?.active ? (
        <FreeCreditsButton promotionCode={promotionCode.id} />
      ) : (
        credits <= 50.0 && <BuyCreditsButton label={t("buy")} path="/billing" />
      )}
      <div className="flex items-center gap-2 md:flex-row-reverse">
        <UserAvatar />
        <div className="flex flex-col gap-0.5 md:items-end">
          <div className="text-sm font-semibold">{user.name}</div>
          <div className="text-muted-foreground text-xs">{creditLabel}</div>
        </div>
      </div>
    </div>
  );
}
