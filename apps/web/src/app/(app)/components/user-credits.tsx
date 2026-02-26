import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import {
  type ActiveSubscription,
  resolveCurrentPlanName,
} from "@/components/billing/subscription-plan-utils";
import { getEnvPublicConfig } from "@/config/env.public";
import { auth, Session } from "@/lib/auth/auth";
import { coreClient } from "@/lib/clients/core.client";
import { CreditUsage } from "@/lib/types/credit";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

import BuyCreditsButton from "./buy-credits-button";
import UserAvatar from "./user-avatar";

interface UserCreditsProps {
  session: Session;
}

interface ParsedSubscriptionCredits {
  remaining: number;
  total: number;
  used: number;
}

interface ParsedCredits {
  subscriptionCredits: ParsedSubscriptionCredits | null;
  total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(value, 0);
}

function parseCreditsResponse(data: unknown): ParsedCredits {
  if (!isRecord(data) || !("credits" in data)) {
    return { subscriptionCredits: null, total: 0 };
  }

  const rawCredits = data.credits;
  if (typeof rawCredits === "number") {
    return {
      subscriptionCredits: null,
      total: toNonNegativeNumber(rawCredits) ?? 0,
    };
  }

  if (!isRecord(rawCredits)) {
    return { subscriptionCredits: null, total: 0 };
  }

  let subscriptionCredits: ParsedSubscriptionCredits | null = null;
  if (
    isRecord(rawCredits.subscription) &&
    isRecord(rawCredits.subscription.credits)
  ) {
    const rawSubscriptionCredits = rawCredits.subscription.credits;
    const remaining = toNonNegativeNumber(rawSubscriptionCredits.remaining) ?? 0;
    const used = toNonNegativeNumber(rawSubscriptionCredits.used) ?? 0;
    const total =
      toNonNegativeNumber(rawSubscriptionCredits.total) ?? remaining + used;

    subscriptionCredits = {
      total,
      used,
      remaining,
    };
  }

  const totalFromResponse = toNonNegativeNumber(rawCredits.total);
  const buffer = toNonNegativeNumber(rawCredits.buffer) ?? 0;

  return {
    subscriptionCredits,
    total: totalFromResponse ?? buffer + (subscriptionCredits?.remaining ?? 0),
  };
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
      const parsedCredits = parseCreditsResponse(creditsResult.value.data);
      credits = parsedCredits.total;
      const subscriptionCredits = parsedCredits.subscriptionCredits;
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

  try {
    const requestHeaders = await headers();
    const activeSubscriptions = await auth.api.listActiveSubscriptions({
      headers: requestHeaders,
      query: hasActiveOrganization
        ? {
            customerType: "organization",
            referenceId: activeOrganizationId,
          }
        : {
            customerType: "user",
          },
    });

    currentPlan =
      resolveCurrentPlanName(activeSubscriptions as ActiveSubscription[]) ??
      "free";
    const planName = tSubscriptions(`Plans.${currentPlan}.name`);

    planLabel = hasActiveOrganization
      ? tPlan("organizationPlan", {
          plan: planName,
          organization: activeOrganizationName ?? t("unavailable"),
        })
      : tPlan("userPlan", { plan: planName });
  } catch (_error) {
    planLabel = tPlan("unavailable");
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
