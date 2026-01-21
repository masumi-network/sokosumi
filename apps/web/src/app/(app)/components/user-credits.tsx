import { convertCentsToCredits } from "@sokosumi/database/helpers";
import {
  creditBucketRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { getTranslations } from "next-intl/server";

import { getEnvPublicConfig } from "@/config/env.public";
import { Session } from "@/lib/auth/auth";
import prisma from "@/lib/db/prisma";
import { userService } from "@/lib/services/user.service";

import BuyCreditsButton from "./buy-credits-button";
import UserAvatar from "./user-avatar";

interface UserCreditsProps {
  session: Session;
}

export default async function UserCredits({ session }: UserCreditsProps) {
  const user = await userRepository.getUserById(session.user.id, prisma);

  const t = await getTranslations("App.Header.Credit");

  if (!user) {
    return (
      <div className="text-muted-foreground text-sm">{t("unavailable")}</div>
    );
  }

  // Check for active organization
  const activeOrganization = await userService.getActiveOrganization();

  // Get appropriate credits based on context
  let creditLabel: string;

  const cents = await creditBucketRepository.getAvailableBalance(
    user.id,
    activeOrganization?.id ?? null,
    prisma,
  );

  const credits = convertCentsToCredits(cents);
  if (activeOrganization) {
    creditLabel = t("organizationBalance", {
      credits: credits,
      organization: activeOrganization.name,
    });
  } else {
    creditLabel = t("userBalance", { credits: credits });
  }

  return (
    <div className="flex flex-1 flex-col-reverse gap-4 md:flex-initial md:flex-row md:items-center">
      {credits <
        getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD && (
        <BuyCreditsButton label={t("buy")} path="/credits" />
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
