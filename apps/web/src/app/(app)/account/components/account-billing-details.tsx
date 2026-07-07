"use client";

import { useTranslations } from "next-intl";

import { BalanceBillingPortalLink } from "@/components/billing/balance-billing-portal-link";
import { StripeBillingInformationCard } from "@/components/billing/stripe-billing-information-card";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

interface AccountBillingDetailsProps {
  billingDetails: StripeCustomerBillingDetails;
}

export function AccountBillingDetails({
  billingDetails,
}: AccountBillingDetailsProps) {
  const t = useTranslations("App.Account.BillingDetails");
  const tBilling = useTranslations("App.Billing");

  const portalLink = billingDetails.stripeCustomerId ? (
    <BalanceBillingPortalLink
      description={tBilling("billingPortalDescription")}
      generalErrorMessage={t("Errors.general")}
      label={tBilling("manageYourBilling")}
      openingLabel={tBilling("openingBillingPortal")}
      returnPath="/account"
      unauthenticatedActionLabel={t("Errors.unauthenticatedAction")}
      unauthenticatedErrorMessage={t("Errors.unauthenticated")}
    />
  ) : null;

  return (
    <StripeBillingInformationCard
      billingDetails={billingDetails}
      portalLink={portalLink}
      translationNamespace="App.Account.BillingDetails"
    />
  );
}
