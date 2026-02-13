"use client";

import { useTranslations } from "next-intl";

import { BillingPortalCard } from "@/components/billing/billing-portal-card";
import { PersonalSubscriptionSection } from "@/components/billing/personal-subscription-section";
import {
  getPlanTranslationKey,
  type SubscriptionPlanView,
} from "@/components/billing/subscription-plan-utils";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";

interface SubscriptionsPageContentProps {
  currentPlan: SubscriptionPlanName | null;
  plans: SubscriptionPlanView[];
  status: "cancel" | "success" | null;
}

export default function SubscriptionsPageContent({
  currentPlan,
  plans,
  status,
}: SubscriptionsPageContentProps) {
  const t = useTranslations("App.Subscriptions");

  return (
    <div className="space-y-8">
      <PersonalSubscriptionSection plans={plans} status={status} />
      <BillingPortalCard
        ctaLabel={t("billingPortalCta")}
        description={
          currentPlan
            ? t("billingPortalDescriptionWithPlan", {
                plan: t(`Plans.${getPlanTranslationKey(currentPlan)}.name`),
              })
            : t("billingPortalDescription")
        }
        generalErrorMessage={t("Errors.general")}
        openingLabel={t("openingBillingPortal")}
        returnPath="/subscriptions"
        title={t("billingPortalTitle")}
        unauthenticatedActionLabel={t("Errors.unauthenticatedAction")}
        unauthenticatedErrorMessage={t("Errors.unauthenticated")}
      />
    </div>
  );
}
