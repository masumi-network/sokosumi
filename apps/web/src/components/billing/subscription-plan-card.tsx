"use client";

import type { PaidSubscriptionPlanName } from "@sokosumi/utils";
import { useFormatter, useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  formatPlanPrice,
  resolvePlanFeatureItems,
  SubscriptionPlanActionButton,
  SubscriptionPlanFeatureList,
} from "./subscription-plan-presentation";
import {
  getPlanTranslationKey,
  type PaidSubscriptionPlanView,
} from "./subscription-plan-utils";

interface SubscriptionPlanCardProps {
  actionLabel?: null | string;
  creditsText?: string;
  isDisabled?: boolean;
  isAnyPlanPending: boolean;
  isPlanPending: boolean;
  onAction: (plan: PaidSubscriptionPlanName) => void;
  plan: PaidSubscriptionPlanView;
  /** Organization checkout: price reads per seat; null hides the total (invalid seat count). */
  seats?: null | number;
}

export function SubscriptionPlanCard({
  actionLabel,
  creditsText,
  isDisabled,
  isAnyPlanPending,
  isPlanPending,
  onAction,
  plan,
  seats,
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
  const formatCurrency = (amount: number, compact: boolean) =>
    formatter.number(amount, {
      style: "currency",
      currency: plan.currency.toUpperCase(),
      ...(compact
        ? { notation: "compact" }
        : { trailingZeroDisplay: "stripIfInteger" }),
    });

  return (
    <Card
      className={cn(
        "flex h-full flex-col",
        plan.isCurrent ? "border-foreground" : undefined,
      )}
    >
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center justify-between">
          <span>{t(`Plans.${translationKey}.name`)}</span>
          {plan.isCurrent ? (
            <span className="text-foreground text-xs font-medium">
              {t("currentPlanBadge")}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          {t(`Plans.${translationKey}.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-medium md:text-3xl tabular-nums tracking-tight">
          {formatPlanPrice({
            formatCurrency: (amount) => formatCurrency(amount, true),
            freePriceLabel: t("freePrice"),
            monthlyAmount: plan.monthlyAmount,
          })}
        </p>
        <p className="text-muted-foreground text-sm">
          {seats === undefined ? t("pricePerMonth") : t("pricePerSeatPerMonth")}
        </p>
        <p className="text-sm">
          {creditsText ?? t("includedCredits", { credits: plan.credits })}
        </p>
        <SubscriptionPlanFeatureList
          items={featureItems}
          title={t(`Plans.${translationKey}.features.title`)}
        />
      </CardContent>
      {resolvedActionLabel ? (
        <CardFooter className="mt-auto flex-col items-stretch gap-3">
          {seats ? (
            <p aria-live="polite" className="text-sm font-medium tabular-nums">
              {t("seatTotal", {
                seats,
                total: formatCurrency(
                  (plan.monthlyAmount * seats) / 100,
                  false,
                ),
              })}
            </p>
          ) : null}
          <SubscriptionPlanActionButton
            actionLabel={resolvedActionLabel}
            disabled={resolvedDisabled}
            isCurrent={plan.isCurrent}
            isPlanPending={isPlanPending}
            onPress={() => onAction(plan.name)}
          />
        </CardFooter>
      ) : null}
    </Card>
  );
}
