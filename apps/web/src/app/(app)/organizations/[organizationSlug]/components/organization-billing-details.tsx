"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { BalanceBillingPortalLink } from "@/components/billing/balance-billing-portal-link";
import { StripeBillingInformationCard } from "@/components/billing/stripe-billing-information-card";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

interface OrganizationBillingDetailsProps {
  billingDetails?: StripeCustomerBillingDetails;
  billingDetailsLoadError?: ReactNode;
  organizationId: string;
  organizationSlug: string;
}

export default function OrganizationBillingDetails({
  billingDetails,
  billingDetailsLoadError,
  organizationId,
  organizationSlug,
}: OrganizationBillingDetailsProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.BillingDetails",
  );
  const tBilling = useTranslations("App.Billing");

  if (billingDetailsLoadError) {
    return billingDetailsLoadError;
  }

  if (!billingDetails) {
    return null;
  }

  const returnPath = `/organizations/${organizationSlug}`;

  const portalLink = billingDetails.stripeCustomerId ? (
    <BalanceBillingPortalLink
      description={tBilling("billingPortalDescription")}
      generalErrorMessage={t("Errors.general")}
      label={tBilling("manageYourBilling")}
      openingLabel={tBilling("openingBillingPortal")}
      organizationId={organizationId}
      returnPath={returnPath}
      unauthenticatedActionLabel={t("Errors.unauthenticatedAction")}
      unauthenticatedErrorMessage={t("Errors.unauthenticated")}
      unauthorizedErrorMessage={t("Errors.unauthorized")}
    />
  ) : null;

  return (
    <StripeBillingInformationCard
      billingDetails={billingDetails}
      portalLink={portalLink}
      translationNamespace="App.Organizations.OrganizationDetail.BillingDetails"
    />
  );
}
