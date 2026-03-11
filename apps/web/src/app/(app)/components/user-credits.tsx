import { getTranslations } from "next-intl/server";

import { getEnvPublicConfig } from "@/config/env.public";
import { Session } from "@/lib/auth/auth";
import { coreClient } from "@/lib/clients/core.client";
import { CreditUsage } from "@/lib/types/credit";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

import BuyCreditsButton from "./buy-credits-button";
import UserAvatar from "./user-avatar";
import { resolveUserCreditsCta } from "./user-credits-cta";

interface UserCreditsProps {
  session: Session;
  showAvatar?: boolean;
  showCtaButtons?: boolean;
  showCreditUsage?: boolean;
  showCreditUsageOnMobileOnly?: boolean;
}

export default async function UserCredits({
  session,
  showAvatar = true,
  showCtaButtons = true,
  showCreditUsage = true,
  showCreditUsageOnMobileOnly = false,
}: UserCreditsProps) {
  const t = await getTranslations("App.Header.Credit");
  const tPlan = await getTranslations("App.Header.Plan");
  const tSubscriptions = await getTranslations("App.Subscriptions");
  const currentTimestampMs = Date.now();
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const hasActiveOrganization = activeOrganizationId !== null;
  const primaryLabel =
    session.user.name ?? session.user.email ?? t("unavailable");

  // Get appropriate credits based on context
  let planLabel: string;
  let currentPlan: string | null = null;
  let credits: number | null = null;
  let creditUsage: CreditUsage | null = null;
  let subscriptionPeriodEndMs: number | null = null;
  let activeOrganizationName: string | null = null;

  try {
    const [creditsResult, organizationsResult] = await Promise.allSettled([
      coreClient.getMyCredits(),
      activeOrganizationId ? coreClient.getMyOrganizations() : null,
    ]);

    if (creditsResult.status === "fulfilled") {
      const creditsResponse = creditsResult.value.data.credits;
      credits = creditsResponse.buffer;
      currentPlan = creditsResponse.subscription?.plan ?? "free";
      subscriptionPeriodEndMs = creditsResponse.subscription?.periodEnd
        ? new Date(creditsResponse.subscription.periodEnd).getTime()
        : null;
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
      : t("extraCredits", { credits: displayCredits });

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
  const cta = resolveUserCreditsCta({
    currentPlan,
    hasLowCredits,
  });

  const shouldShowUpgradeCta = showCtaButtons && cta === "upgradePlan";
  const shouldShowAddCreditsCta = showCtaButtons && cta === "addCredits";

  return (
    <div className="flex w-full flex-1 flex-col-reverse gap-4 md:flex-initial md:flex-row md:items-center">
      {shouldShowUpgradeCta ? (
        <BuyCreditsButton
          label={tPlan("upgradeCta")}
          path="/billing?tab=subscription"
        />
      ) : null}
      {shouldShowAddCreditsCta ? (
        <BuyCreditsButton label={t("buy")} path="/billing?tab=credits" />
      ) : null}
      {showAvatar || showCreditUsage ? (
        <UserAvatar
          session={session}
          showAvatar={showAvatar}
          showCreditUsage={showCreditUsage}
          showCreditUsageOnMobileOnly={showCreditUsageOnMobileOnly}
          primaryLabel={primaryLabel}
          secondaryLabel={planLabel}
          creditsLabel={creditsLabel}
          creditUsage={creditUsage}
          subscriptionPeriodEndMs={subscriptionPeriodEndMs}
          currentTimestampMs={currentTimestampMs}
        />
      ) : null}
    </div>
  );
}
