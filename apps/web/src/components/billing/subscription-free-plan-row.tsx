"use client";

import { useFormatter, useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";
import { cn } from "@/lib/utils";

import {
  formatPlanPrice,
  resolvePlanFeatureItems,
  SubscriptionPlanActionButton,
  SubscriptionPlanFeatureList,
} from "./subscription-plan-presentation";
import {
  getPlanTranslationKey,
  type SubscriptionPlanView,
} from "./subscription-plan-utils";

interface SubscriptionFreePlanRowProps {
  actionLabel?: string;
  creditsText?: string;
  isDisabled?: boolean;
  isAnyPlanPending: boolean;
  isPlanPending: boolean;
  loadingLabel?: string;
  onUpgrade: (plan: SubscriptionPlanName) => void;
  plan: SubscriptionPlanView;
}

export function SubscriptionFreePlanRow({
  actionLabel,
  creditsText,
  isDisabled,
  isAnyPlanPending,
  isPlanPending,
  loadingLabel,
  onUpgrade,
  plan,
}: SubscriptionFreePlanRowProps) {
  const t = useTranslations("App.Subscriptions");
  const formatter = useFormatter();
  const translationKey = getPlanTranslationKey(plan.name);
  const featureItems = resolvePlanFeatureItems(
    t.raw(`Plans.${translationKey}.features.items`),
  );
  const resolvedDisabled = isDisabled ?? (isAnyPlanPending || plan.isCurrent);
  const resolvedActionLabel =
    actionLabel ?? (plan.isCurrent ? t("currentPlanCta") : t("upgradePlanCta"));
  const resolvedLoadingLabel = loadingLabel ?? t("upgrading");

  return (
    <Card
      className={cn(
        "overflow-hidden",
        plan.isCurrent ? "border-primary" : undefined,
      )}
    >
      <CardContent className="grid gap-6 md:grid-cols-3 md:items-start">
        <div className="space-y-3">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2">
              <span>{t(`Plans.${translationKey}.name`)}</span>
              {plan.isCurrent ? (
                <span className="text-primary text-xs font-medium">
                  {t("currentPlanBadge")}
                </span>
              ) : null}
            </CardTitle>
            <CardDescription>
              {t(`Plans.${translationKey}.description`)}
            </CardDescription>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-medium md:text-3xl">
              {formatPlanPrice({
                formatCurrency: (amount) =>
                  formatter.number(amount, {
                    style: "currency",
                    currency: plan.currency.toUpperCase(),
                  }),
                freePriceLabel: t("freePrice"),
                monthlyAmount: plan.monthlyAmount,
              })}
            </p>
            <p className="text-muted-foreground text-sm">
              {t("pricePerMonth")}
            </p>
          </div>
          <p className="text-sm">
            {creditsText ?? t("includedCredits", { credits: plan.credits })}
          </p>
        </div>

        <SubscriptionPlanFeatureList
          items={featureItems}
          title={t(`Plans.${translationKey}.features.title`)}
        />

        <div className="flex md:min-h-full md:items-center md:justify-end">
          <div className="flex w-full md:max-w-56 md:justify-end">
            <SubscriptionPlanActionButton
              actionLabel={resolvedActionLabel}
              disabled={resolvedDisabled}
              isCurrent={plan.isCurrent}
              isPlanPending={isPlanPending}
              loadingLabel={resolvedLoadingLabel}
              onUpgrade={onUpgrade}
              planName={plan.name}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
