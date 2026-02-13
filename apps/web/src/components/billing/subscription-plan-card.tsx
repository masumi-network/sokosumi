"use client";

import { Check, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
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
  getPlanTranslationKey,
  type SubscriptionPlanView,
} from "./subscription-plan-utils";

interface SubscriptionPlanCardProps {
  actionLabel?: string;
  creditsText?: string;
  isDisabled?: boolean;
  isAnyPlanPending: boolean;
  isPlanPending: boolean;
  loadingLabel?: string;
  onUpgrade: (plan: SubscriptionPlanName) => void;
  plan: SubscriptionPlanView;
}

export function SubscriptionPlanCard({
  actionLabel,
  creditsText,
  isDisabled,
  isAnyPlanPending,
  isPlanPending,
  loadingLabel,
  onUpgrade,
  plan,
}: SubscriptionPlanCardProps) {
  const t = useTranslations("App.Subscriptions");
  const formatter = useFormatter();
  const translationKey = getPlanTranslationKey(plan.name);
  const rawItems = t.raw(`Plans.${translationKey}.features.items`);
  const featureItems =
    rawItems !== null &&
    typeof rawItems === "object" &&
    !Array.isArray(rawItems)
      ? Object.values(rawItems).filter(
          (item): item is string => typeof item === "string",
        )
      : [];
  const resolvedDisabled = isDisabled ?? (isAnyPlanPending || plan.isCurrent);
  const resolvedActionLabel =
    actionLabel ?? (plan.isCurrent ? t("currentPlanCta") : t("upgradePlanCta"));
  const resolvedLoadingLabel = loadingLabel ?? t("upgrading");

  function formatPrice(monthlyAmount: number, currency: string): string {
    if (monthlyAmount === 0) {
      return t("freePrice");
    }
    return formatter.number(monthlyAmount / 100, {
      style: "currency",
      currency: currency.toUpperCase(),
    });
  }

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
          {formatPrice(plan.monthlyAmount, plan.currency)}
        </p>
        <p className="text-muted-foreground text-sm">{t("pricePerMonth")}</p>
        <p className="text-sm">
          {creditsText ?? t("includedCredits", { credits: plan.credits })}
        </p>
        <div className="space-y-2 pt-2">
          <p className="text-muted-foreground text-xs font-semibold">
            {t(`Plans.${translationKey}.features.title`)}
          </p>
          <ul className="space-y-2 text-sm">
            {featureItems.map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="text-primary mt-0.5 size-4" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardFooter className="mt-auto">
        <Button
          className="w-full"
          variant={plan.isCurrent ? "outline" : "default"}
          disabled={resolvedDisabled}
          onClick={() => onUpgrade(plan.name)}
        >
          {isPlanPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {resolvedLoadingLabel}
            </>
          ) : (
            resolvedActionLabel
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
