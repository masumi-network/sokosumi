"use client";

import type { StripeCustomerBillingDetails } from "@sokosumi/core-client";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  StripeBillingInformationFields,
  type StripeBillingInformationTranslationNamespace,
} from "@/components/billing/stripe-billing-information-fields";
import { buildStripeBillingInformationFieldsProps } from "@/lib/billing/build-stripe-billing-information-fields-props";

export interface StripeBillingInformationContentProps {
  billingDetails: StripeCustomerBillingDetails;
  portalLink?: ReactNode;
  showStripeCustomerId?: boolean;
  translationNamespace: StripeBillingInformationTranslationNamespace;
}

export function StripeBillingInformationContent({
  billingDetails,
  portalLink,
  showStripeCustomerId = false,
  translationNamespace,
}: StripeBillingInformationContentProps) {
  const t = useTranslations(translationNamespace);
  const locale = useLocale();

  return (
    <StripeBillingInformationFields
      {...buildStripeBillingInformationFieldsProps(billingDetails, t, locale, {
        showStripeCustomerId,
      })}
      portalLink={portalLink}
    />
  );
}
