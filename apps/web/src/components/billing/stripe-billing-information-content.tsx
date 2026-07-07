"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  StripeBillingInformationFields,
  type StripeBillingInformationTranslationNamespace,
} from "@/components/billing/stripe-billing-information-fields";
import { buildStripeBillingInformationFieldsProps } from "@/lib/billing/build-stripe-billing-information-fields-props";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

export interface StripeBillingInformationContentProps {
  billingDetails: StripeCustomerBillingDetails;
  portalLink?: ReactNode;
  translationNamespace: StripeBillingInformationTranslationNamespace;
}

export function StripeBillingInformationContent({
  billingDetails,
  portalLink,
  translationNamespace,
}: StripeBillingInformationContentProps) {
  const t = useTranslations(translationNamespace);
  const locale = useLocale();

  return (
    <StripeBillingInformationFields
      {...buildStripeBillingInformationFieldsProps(billingDetails, t, locale)}
      portalLink={portalLink}
    />
  );
}
