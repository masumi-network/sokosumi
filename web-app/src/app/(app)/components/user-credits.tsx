import { getTranslations } from "next-intl/server";

import { getEnvPublicConfig } from "@/config/env.public";
import { Session } from "@/lib/auth/auth";
import { convertCentsToCredits } from "@/lib/db";
import {
  creditTransactionRepository,
  userRepository,
} from "@/lib/db/repositories";
import { userService } from "@/lib/services/user.service";

import BuyCreditsButton from "./buy-credits-button";
import ClaimHydraPointsButton from "./claim-hydra-points-button";
import UserAvatar from "./user-avatar";

interface UserCreditsProps {
  session: Session;
}

export default async function UserCredits({ session }: UserCreditsProps) {
  const user = await userRepository.getUserById(session.user.id);

  const t = await getTranslations("App.Header.Credit");
  const isHydraDialogEnabled =
    getEnvPublicConfig().NEXT_PUBLIC_ENABLE_MOBILE_HYDRA_DIALOG;

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

  return (
    <div className="flex flex-1 flex-col-reverse gap-4 md:flex-initial md:flex-row md:items-center">
      {isHydraDialogEnabled ? (
        <ClaimHydraPointsButton />
      ) : (
        credits <= 50.0 && <BuyCreditsButton label={t("buy")} path="/billing" />
      )}
      <div className="flex items-center gap-2 md:flex-row-reverse">
        <UserAvatar session={session} />
        <div className="flex flex-col gap-0.5 md:items-end">
          <div className="text-sm font-semibold">{user.name}</div>
          <div className="text-muted-foreground text-xs">{creditLabel}</div>
        </div>
      </div>
    </div>
  );
}
