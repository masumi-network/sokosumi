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
  actionLabel?: null | string;
  creditsText?: string;
  isDisabled?: boolean;
  isAnyPlanPending: boolean;
  isPlanPending: boolean;
  loadingLabel?: string;
  onAction: (plan: SubscriptionPlanName) => void;
  plan: SubscriptionPlanView;
}

export function SubscriptionFreePlanRow({
  actionLabel,
  creditsText,
  isDisabled,
  isAnyPlanPending,
  isPlanPending,
  loadingLabel,
  onAction,
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
    actionLabel === undefined
      ? plan.isCurrent
        ? t("currentPlanCta")
        : t("upgradePlanCta")
      : actionLabel;
  const resolvedLoadingLabel = loadingLabel ?? t("upgrading");
  const hasAction = resolvedActionLabel !== null;

  return (
    <Card
      className={cn(
        "overflow-hidden",
        plan.isCurrent ? "border-primary" : undefined,
      )}
    >
      <CardContent
        className={cn(
          "grid gap-6 md:items-start",
          hasAction
            ? "md:grid-cols-3"
            : "md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-10",
        )}
      >
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
                    notation: "compact",
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

        <div className={cn(!hasAction ? "md:max-w-2xl" : undefined)}>
          <SubscriptionPlanFeatureList
            items={featureItems}
            title={t(`Plans.${translationKey}.features.title`)}
          />
        </div>

        {hasAction ? (
          <div className="flex md:min-h-full md:items-center md:justify-end">
            <div className="flex w-full md:max-w-56 md:justify-end">
              <SubscriptionPlanActionButton
                actionLabel={resolvedActionLabel}
                disabled={resolvedDisabled}
                isCurrent={plan.isCurrent}
                isPlanPending={isPlanPending}
                loadingLabel={resolvedLoadingLabel}
                onAction={onAction}
                planName={plan.name}
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
