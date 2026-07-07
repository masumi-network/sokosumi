import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

import {
  StripeBillingInformationContent,
  type StripeBillingInformationTranslationNamespace,
} from "./stripe-billing-information-content";

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
  const t = await getTranslations(translationNamespace);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <StripeBillingInformationContent
          billingDetails={billingDetails}
          portalLink={portalLink}
          translationNamespace={translationNamespace}
        />
      </CardContent>
    </Card>
  );
}
