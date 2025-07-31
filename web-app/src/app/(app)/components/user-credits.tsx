import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import {
  getActiveOrganization,
  getOrganizationCredits,
  getUserCredits,
  getWelcomePromotionCode,
} from "@/lib/services";
import { userService } from "@/lib/services/user.service";

import FreeCreditsButton from "./free-credits-button";

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
  const activeOrganization = await getActiveOrganization();

  // Get appropriate credits based on context
  let credits: number;
  let creditLabel: string;

  if (activeOrganization) {
    credits = await getOrganizationCredits(activeOrganization.id);
    creditLabel = t("organizationBalance", {
      credits: credits,
      organization: activeOrganization.name,
    });
  } else {
    credits = await getUserCredits(user.id);
    creditLabel = t("userBalance", { credits: credits });
  }

  const promotionCode = await getWelcomePromotionCode(user.id);

  return (
    <div className="flex items-center gap-4">
      {promotionCode?.active && !activeOrganization ? (
        <FreeCreditsButton promotionCode={promotionCode.id} />
      ) : (
        credits <= 50.0 && (
          <Button variant="default" size="sm" asChild>
            <Link href="/billing">{t("buy")}</Link>
          </Button>
        )
      )}
      <div className="flex flex-col items-end gap-0.5">
        <div className="text-sm font-semibold">{user.name}</div>
        <div className="text-muted-foreground text-xs">{creditLabel}</div>
      </div>
    </div>
  );
}
