"use client";

import { useFormatter, useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  formatPlanPrice,
  resolvePlanFeatureItems,
  SubscriptionPlanFeatureList,
} from "./subscription-plan-presentation";
import {
  getPlanTranslationKey,
  type SubscriptionPlanView,
} from "./subscription-plan-utils";

interface SubscriptionFreePlanRowProps {
  creditsText?: string;
  plan: SubscriptionPlanView;
}

export function SubscriptionFreePlanRow({
  creditsText,
  plan,
}: SubscriptionFreePlanRowProps) {
  const t = useTranslations("App.Subscriptions");
  const formatter = useFormatter();
  const translationKey = getPlanTranslationKey(plan.name);
  const featureItems = resolvePlanFeatureItems(
    t.raw(`Plans.${translationKey}.features.items`),
  );

  return (
    <Card
      className={cn(
        "overflow-hidden",
        plan.isCurrent ? "border-primary" : undefined,
      )}
    >
      <CardContent className="grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-start md:gap-10">
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

        <div className="md:max-w-2xl">
          <SubscriptionPlanFeatureList
            items={featureItems}
            title={t(`Plans.${translationKey}.features.title`)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
