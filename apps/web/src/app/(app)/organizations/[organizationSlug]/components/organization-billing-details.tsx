import { getTranslations } from "next-intl/server";
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

export default async function OrganizationBillingDetails({
  billingDetails,
  billingDetailsLoadError,
  organizationId,
  organizationSlug,
}: OrganizationBillingDetailsProps) {
  const tBilling = await getTranslations("App.Billing");

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
      label={tBilling("manageYourBilling")}
      organizationId={organizationId}
      returnPath={returnPath}
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
