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

import {
  resolvePlanFeatureItems,
  SubscriptionPlanFeatureList,
} from "./subscription-plan-presentation";

const ENTERPRISE_CONTACT_HREF = "mailto:info@sokosumi.com";

export function SubscriptionEnterprisePlanCard() {
  const t = useTranslations("App.Subscriptions");
  const featureItems = resolvePlanFeatureItems(
    t.raw("Plans.enterprise.features.items"),
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="space-y-2">
        <CardTitle>{t("Plans.enterprise.name")}</CardTitle>
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
        <Button asChild className="w-full" variant="outline">
          <a href={ENTERPRISE_CONTACT_HREF}>{t("contactUsCta")}</a>
        </Button>
      </CardFooter>
    </Card>
  );
}
