"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
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
  resolvePlanFeatureItems,
  SubscriptionPlanActionButton,
  SubscriptionPlanFeatureList,
} from "./subscription-plan-presentation";

const ENTERPRISE_CONTACT_HREF = "mailto:info@sokosumi.com";

interface SubscriptionEnterprisePlanCardProps {
  actionLabel?: null | string;
  isCurrent?: boolean;
}

export function SubscriptionEnterprisePlanCard({
  actionLabel,
  isCurrent = false,
}: SubscriptionEnterprisePlanCardProps) {
  const t = useTranslations("App.Subscriptions");
  const featureItems = resolvePlanFeatureItems(
    t.raw("Plans.enterprise.features.items"),
  );
  const resolvedActionLabel = isCurrent
    ? (actionLabel ?? t("currentPlanCta"))
    : null;

  return (
    <Card
      className={cn(
        "flex h-full flex-col",
        isCurrent ? "border-primary" : undefined,
      )}
    >
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center justify-between">
          <span>{t("Plans.enterprise.name")}</span>
          {isCurrent ? (
            <span className="text-primary text-xs font-medium">
              {t("currentPlanBadge")}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>{t("Plans.enterprise.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-medium md:text-3xl">{t("customPrice")}</p>
        <p className="text-muted-foreground text-sm">{t("pricePerMonth")}</p>
        <SubscriptionPlanFeatureList
          items={featureItems}
          title={t("Plans.enterprise.features.title")}
        />
      </CardContent>
      <CardFooter className="mt-auto">
        {resolvedActionLabel ? (
          <SubscriptionPlanActionButton
            actionLabel={resolvedActionLabel}
            disabled
            isCurrent={isCurrent}
            isPlanPending={false}
            loadingLabel={t("updating")}
            onPress={() => undefined}
          />
        ) : (
          <Button asChild className="w-full" variant="outline">
            <a href={ENTERPRISE_CONTACT_HREF}>{t("contactUsCta")}</a>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
