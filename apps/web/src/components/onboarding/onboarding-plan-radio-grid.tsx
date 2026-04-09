"use client";

import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";
import { cn } from "@/lib/utils";

import {
  formatPlanPrice,
  resolvePlanFeatureItems,
  SubscriptionPlanFeatureList,
} from "../billing/subscription-plan-presentation";
import {
  getPlanTranslationKey,
  type SubscriptionPlanView,
} from "../billing/subscription-plan-utils";

interface OnboardingPlanRadioGridProps {
  plans: SubscriptionPlanView[];
  recommendedPlan?: SubscriptionPlanName;
  value: SubscriptionPlanName;
  onValueChange: (value: SubscriptionPlanName) => void;
}

const FEATURE_HIGHLIGHT_LIMIT = 3;

export function OnboardingPlanRadioGrid({
  plans,
  recommendedPlan = "standard",
  value,
  onValueChange,
}: OnboardingPlanRadioGridProps) {
  const t = useTranslations("App.Subscriptions");
  const formatter = useFormatter();

  function handleValueChange(nextValue: string) {
    const nextPlan = plans.find((plan) => plan.name === nextValue);
    if (nextPlan && !nextPlan.isCurrent) {
      onValueChange(nextPlan.name);
    }
  }

  return (
    <RadioGroup
      className="grid gap-4 md:grid-cols-3 pt-0 md:pt-10"
      value={value}
      onValueChange={handleValueChange}
    >
      {plans.map((plan) => {
        const translationKey = getPlanTranslationKey(plan.name);
        const featureItems = resolvePlanFeatureItems(
          t.raw(`Plans.${translationKey}.features.items`),
        ).slice(0, FEATURE_HIGHLIGHT_LIMIT);
        const isSelected = value === plan.name;
        const isRecommended = !plan.isCurrent && plan.name === recommendedPlan;
        const radioId = `onboarding-plan-${plan.name}`;

        return (
          <Label
            key={plan.name}
            className={cn(
              "h-full",
              plan.isCurrent ? "cursor-not-allowed" : "cursor-pointer",
            )}
          >
            <Card
              className={cn(
                "w-full h-full gap-0 border-2 py-2 transition-all",
                plan.isCurrent
                  ? "border-muted-foreground/60 bg-muted/30"
                  : undefined,
                isSelected && !plan.isCurrent
                  ? "border-primary ring-primary/10 shadow-sm ring-4"
                  : !plan.isCurrent
                    ? "hover:border-primary/40"
                    : undefined,
              )}
              onClick={() => {
                if (!plan.isCurrent) {
                  onValueChange(plan.name);
                }
              }}
            >
              <CardHeader className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3 min-h-24">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xl font-semibold">
                        {t(`Plans.${translationKey}.name`)}
                      </CardTitle>
                      {plan.isCurrent ? (
                        <span className="text-primary text-xs font-medium">
                          {t("currentPlanBadge")}
                        </span>
                      ) : null}
                      {isRecommended ? (
                        <Badge variant="secondary">
                          {t("mostPopularBadge")}
                        </Badge>
                      ) : null}
                    </div>
                    <CardDescription>
                      {t(`Plans.${translationKey}.description`)}
                    </CardDescription>
                  </div>
                  <RadioGroupItem
                    id={radioId}
                    value={plan.name}
                    aria-label={t(`Plans.${translationKey}.name`)}
                    disabled={plan.isCurrent}
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
                <div className="space-y-1 pb-2">
                  <p className="text-2xl md:text-4xl font-semibold">
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
              </CardHeader>
              <CardContent className="space-y-4 p-5 pt-0">
                <p className="text-sm">
                  {t("includedCredits", { credits: plan.credits })}
                </p>
                <SubscriptionPlanFeatureList
                  items={featureItems}
                  title={t(`Plans.${translationKey}.features.title`)}
                />
              </CardContent>
            </Card>
          </Label>
        );
      })}
    </RadioGroup>
  );
}
