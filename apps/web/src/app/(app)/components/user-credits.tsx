import { getTranslations } from "next-intl/server";

import { getEnvPublicConfig } from "@/config/env.public";
import { Session } from "@/lib/auth/auth";
import { coreClient } from "@/lib/clients/core.client";
import { CreditUsage } from "@/lib/types/credit";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

import BuyCreditsButton from "./buy-credits-button";
import UserAvatar from "./user-avatar";

interface UserCreditsProps {
  session: Session;
}

export default async function UserCredits({ session }: UserCreditsProps) {
  const t = await getTranslations("App.Header.Credit");
  const tPlan = await getTranslations("App.Header.Plan");
  const tSubscriptions = await getTranslations("App.Subscriptions");
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const hasActiveOrganization = activeOrganizationId !== null;
  const primaryLabel =
    session.user.name ?? session.user.email ?? t("unavailable");

  // Get appropriate credits based on context
  let planLabel: string;
  let currentPlan: string | null = null;
  let credits: number | null = null;
  let creditUsage: CreditUsage | null = null;
  let activeOrganizationName: string | null = null;

  try {
    const [creditsResult, organizationsResult] = await Promise.allSettled([
      coreClient.getMyCredits(),
      activeOrganizationId ? coreClient.getMyOrganizations() : null,
    ]);

    if (creditsResult.status === "fulfilled") {
      const creditsResponse = creditsResult.value.data.credits;
      credits = creditsResponse.total;
      currentPlan = creditsResponse.subscription?.plan ?? "free";
      const subscriptionCredits = creditsResponse.subscription?.credits ?? null;
      if (subscriptionCredits && subscriptionCredits.total > 0) {
        const total = Math.max(subscriptionCredits.total, 0);
        const used = Math.min(Math.max(subscriptionCredits.used, 0), total);
        const remaining = Math.max(subscriptionCredits.remaining, 0);
        const percentageUsed = Math.min(Math.max((used / total) * 100, 0), 100);

        creditUsage = {
          hasUsageData: true,
          percentageUsed,
          remaining,
          total,
          used,
        };
      }
    }

    if (
      activeOrganizationId &&
      organizationsResult.status === "fulfilled" &&
      organizationsResult.value?.data
    ) {
      const foundOrganization = organizationsResult.value.data.find(
        (organization) => organization.id === activeOrganizationId,
      );

      if (foundOrganization) {
        activeOrganizationName = foundOrganization.name;
      }
    }
  } catch (_error) {
    credits = null;
    creditUsage = null;
  }

  const displayCredits = formatCreditsForDisplay(credits ?? 0);
  const creditsLabel =
    credits === null
      ? t("unavailable")
      : hasActiveOrganization
        ? t("organizationBalance", {
            credits: displayCredits,
            organization: activeOrganizationName ?? t("unavailable"),
          })
        : t("userBalance", { credits: displayCredits });

  if (currentPlan === null) {
    planLabel = tPlan("unavailable");
  } else {
    try {
      const planName = tSubscriptions(`Plans.${currentPlan}.name`);
      planLabel = hasActiveOrganization
        ? tPlan("organizationPlan", {
            plan: planName,
            organization: activeOrganizationName ?? t("unavailable"),
          })
        : tPlan("userPlan", { plan: planName });
    } catch (_error) {
      currentPlan = null;
      planLabel = tPlan("unavailable");
    }
  }

  const creditsButtonThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;
  const hasLowCredits =
    typeof credits === "number" && credits < creditsButtonThreshold;
  const shouldShowUpgradePlanCta =
    currentPlan !== null && currentPlan !== "pro";
  const shouldShowAddCreditsCta =
    hasLowCredits && (currentPlan === null || currentPlan !== "free");

  return (
    <div className="flex flex-1 flex-col-reverse gap-4 md:flex-initial md:flex-row md:items-center">
      {!shouldShowAddCreditsCta && shouldShowUpgradePlanCta ? (
        <BuyCreditsButton
          label={tPlan("upgradeCta")}
          path="/billing?tab=subscription"
        />
      ) : null}
      {shouldShowAddCreditsCta ? (
        <BuyCreditsButton label={t("buy")} path="/billing?tab=credits" />
      ) : null}
      <UserAvatar
        session={session}
        primaryLabel={primaryLabel}
        secondaryLabel={planLabel}
        creditsLabel={creditsLabel}
        creditUsage={creditUsage}
      />
    </div>
  );
}
