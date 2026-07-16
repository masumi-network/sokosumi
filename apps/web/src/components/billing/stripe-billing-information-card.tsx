import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  StripeBillingInformationFields,
  type StripeBillingInformationTranslationNamespace,
} from "@/components/billing/stripe-billing-information-fields";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildStripeBillingInformationFieldsProps } from "@/lib/billing/build-stripe-billing-information-fields-props";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

export interface StripeBillingInformationCardProps {
  billingDetails: StripeCustomerBillingDetails;
  portalLink?: ReactNode;
  translationNamespace: StripeBillingInformationTranslationNamespace;
}

export async function StripeBillingInformationCard({
  billingDetails,
  portalLink,
  translationNamespace,
}: StripeBillingInformationCardProps) {
  const [t, locale] = await Promise.all([
    getTranslations(translationNamespace),
    getLocale(),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <StripeBillingInformationFields
          {...buildStripeBillingInformationFieldsProps(
            billingDetails,
            t,
            locale,
          )}
          portalLink={portalLink}
        />
      </CardContent>
    </Card>
  );
}
