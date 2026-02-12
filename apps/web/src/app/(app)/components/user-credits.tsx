import { convertCentsToCredits } from "@sokosumi/database/helpers";
import {
  creditBucketRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { getEnvPublicConfig } from "@/config/env.public";
import { auth, Session } from "@/lib/auth/auth";
import prisma from "@/lib/db/prisma";
import {
  type ActiveSubscription,
  getPlanTranslationKey,
  resolveCurrentPlanName,
} from "@/lib/helpers/subscription";
import { userService } from "@/lib/services/user.service";

import BuyCreditsButton from "./buy-credits-button";
import UserAvatar from "./user-avatar";

interface UserCreditsProps {
  session: Session;
}

export default async function UserCredits({ session }: UserCreditsProps) {
  const user = await userRepository.getUserById(session.user.id, prisma);

  const t = await getTranslations("App.Header.Credit");
  const tPlan = await getTranslations("App.Header.Plan");
  const tSubscriptions = await getTranslations("App.Subscriptions");

  if (!user) {
    return (
      <div className="text-muted-foreground text-sm">{t("unavailable")}</div>
    );
  }

  // Check for active organization
  const activeOrganization = await userService.getActiveOrganization();

  // Get appropriate credits based on context
  let planLabel: string;

  const cents = await creditBucketRepository.getBalance(
    user.id,
    activeOrganization?.id ?? null,
    prisma,
  );

  const credits = convertCentsToCredits(cents);
  const creditsLabel = activeOrganization
    ? t("organizationBalance", {
        credits,
        organization: activeOrganization.name,
      })
    : t("userBalance", { credits });

  try {
    const requestHeaders = await headers();
    const activeSubscriptions = await auth.api.listActiveSubscriptions({
      headers: requestHeaders,
      query: activeOrganization
        ? {
            customerType: "organization",
            referenceId: activeOrganization.id,
          }
        : {
            customerType: "user",
          },
    });

    const currentPlan =
      resolveCurrentPlanName(activeSubscriptions as ActiveSubscription[]) ??
      "free";
    const planName = tSubscriptions(
      `Plans.${getPlanTranslationKey(currentPlan)}.name`,
    );

    planLabel = activeOrganization
      ? tPlan("organizationPlan", {
          plan: planName,
          organization: activeOrganization.name,
        })
      : tPlan("userPlan", { plan: planName });
  } catch (_error) {
    planLabel = tPlan("unavailable");
  }

  return (
    <div className="flex flex-1 flex-col-reverse gap-4 md:flex-initial md:flex-row md:items-center">
      {credits <
        getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD && (
        <BuyCreditsButton label={t("buy")} path="/credits" />
      )}
      <UserAvatar
        session={session}
        primaryLabel={user.name}
        secondaryLabel={planLabel}
        creditsLabel={creditsLabel}
      />
    </div>
  );
}
