"use client";

import { useFormatter, useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
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

interface SubscriptionPlanCardProps {
  actionLabel?: null | string;
  creditsText?: string;
  isDisabled?: boolean;
  isAnyPlanPending: boolean;
  isPlanPending: boolean;
  loadingLabel?: string;
  onAction: (plan: SubscriptionPlanName) => void;
  plan: SubscriptionPlanView;
}

export function SubscriptionPlanCard({
  actionLabel,
  creditsText,
  isDisabled,
  isAnyPlanPending,
  isPlanPending,
  loadingLabel,
  onAction,
  plan,
}: SubscriptionPlanCardProps) {
  const t = useTranslations("App.Subscriptions");
  const formatter = useFormatter();
  const translationKey = getPlanTranslationKey(plan.name);
  const rawItems = t.raw(`Plans.${translationKey}.features.items`);
  const featureItems = resolvePlanFeatureItems(rawItems);
  const resolvedDisabled = isDisabled ?? (isAnyPlanPending || plan.isCurrent);
  const resolvedActionLabel =
    actionLabel === undefined
      ? plan.isCurrent
        ? t("currentPlanCta")
        : t("upgradePlanCta")
      : actionLabel;
  const resolvedLoadingLabel = loadingLabel ?? t("upgrading");

  return (
    <Card
      className={cn(
        "flex h-full flex-col",
        plan.isCurrent ? "border-primary" : undefined,
      )}
    >
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center justify-between">
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
      </CardHeader>
      <CardContent className="space-y-3">
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
        <p className="text-muted-foreground text-sm">{t("pricePerMonth")}</p>
        <p className="text-sm">
          {creditsText ?? t("includedCredits", { credits: plan.credits })}
        </p>
        <SubscriptionPlanFeatureList
          items={featureItems}
          title={t(`Plans.${translationKey}.features.title`)}
        />
      </CardContent>
      {resolvedActionLabel ? (
        <CardFooter className="mt-auto">
          <SubscriptionPlanActionButton
            actionLabel={resolvedActionLabel}
            disabled={resolvedDisabled}
            isCurrent={plan.isCurrent}
            isPlanPending={isPlanPending}
            loadingLabel={resolvedLoadingLabel}
            onAction={onAction}
            planName={plan.name}
          />
        </CardFooter>
      ) : null}
    </Card>
  );
}
