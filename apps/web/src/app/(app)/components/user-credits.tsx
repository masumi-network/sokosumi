import { getTranslations } from "next-intl/server";

import type { Session } from "@/lib/auth/auth";
import type { GetUsersByIdCreditsResponse } from "@/lib/clients/generated/core/types.gen";
import type { CreditUsage } from "@/lib/types/credit";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

import CreditCta from "./credit-cta";
import CreditUsageComponent from "./credit-usage";
import UserAvatar from "./user-avatar";

export type UserCreditsData = GetUsersByIdCreditsResponse["data"]["credits"];

interface UserCreditsProps {
  creditsData: UserCreditsData | null;
  currentTimestampMs: number;
  organizationName: string | null;
  session: Session;
  showAvatar?: boolean;
  showCtaButtons?: boolean;
  showCreditUsage?: boolean;
  lowCreditsThreshold: number;
}

export default async function UserCredits({
  creditsData,
  currentTimestampMs,
  organizationName,
  session,
  showAvatar = true,
  showCtaButtons = true,
  showCreditUsage = true,
  lowCreditsThreshold,
}: UserCreditsProps) {
  const t = await getTranslations("App.Header.Credit");
  const tPlan = await getTranslations("App.Header.Plan");
  const tSubscriptions = await getTranslations("App.Subscriptions");
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const hasActiveOrganization = activeOrganizationId !== null;

  // Get appropriate credits based on context
  let planLabel: string;
  let currentPlan: string | null = null;
  let credits: number | null = null;
  let creditUsage: CreditUsage | null = null;
  let subscriptionPeriodEndMs: number | null = null;
  const subscription = creditsData?.subscription ?? null;

  if (creditsData) {
    credits = creditsData.buffer;
    currentPlan = subscription?.plan ?? "free";
    subscriptionPeriodEndMs = subscription?.periodEnd
      ? new Date(subscription.periodEnd).getTime()
      : null;
    const subscriptionCredits = subscription?.credits ?? null;
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
            organization: organizationName ?? t("unavailable"),
          })
        : tPlan("userPlan", { plan: planName });
    } catch (_error) {
      currentPlan = null;
      planLabel = tPlan("unavailable");
    }
  }

  return (
    <div className="flex w-full flex-1 flex-col-reverse gap-4 group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:flex-none md:flex-initial md:flex-row md:items-center">
      {showCtaButtons ? <CreditCta currentPlan={currentPlan} /> : null}
      {showAvatar || showCreditUsage ? (
        <div className="flex w-full flex-col items-stretch gap-4 group-data-[collapsible=icon]:items-center">
          {showCreditUsage ? (
            <CreditUsageComponent
              creditUsage={creditUsage}
              extraCredits={credits}
              creditsLabel={creditsLabel}
              currentTimestampMs={currentTimestampMs}
              subscriptionPeriodEndMs={subscriptionPeriodEndMs}
              lowCreditsThreshold={lowCreditsThreshold}
            />
          ) : null}
          {showAvatar ? (
            <UserAvatar session={session} secondaryLabel={planLabel} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
