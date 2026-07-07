import { getTranslations } from "next-intl/server";

import { BalanceBillingPortalLink } from "@/components/billing/balance-billing-portal-link";
import { StripeBillingInformationCard } from "@/components/billing/stripe-billing-information-card";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

interface AccountBillingDetailsProps {
  billingDetails: StripeCustomerBillingDetails;
}

export async function AccountBillingDetails({
  billingDetails,
}: AccountBillingDetailsProps) {
  const tBilling = await getTranslations("App.Billing");

  const portalLink = billingDetails.stripeCustomerId ? (
    <BalanceBillingPortalLink
      description={tBilling("billingPortalDescription")}
      label={tBilling("manageYourBilling")}
      returnPath="/account"
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
