"use client";

import { MemberRole } from "@sokosumi/utils";
import { useTranslations } from "next-intl";

import { BalanceBillingPortalLink } from "@/components/billing/balance-billing-portal-link";
import { StripeBillingInformationCard } from "@/components/billing/stripe-billing-information-card";
import type {
  MemberRecord,
  OrganizationRecord,
  StripeCustomerBillingDetails,
} from "@/lib/clients/generated/core";

interface OrganizationBillingDetailsProps {
  billingDetails: StripeCustomerBillingDetails;
  member: MemberRecord;
  organization: OrganizationRecord;
  organizationSlug: string;
}

export default function OrganizationBillingDetails({
  billingDetails,
  member,
  organization,
  organizationSlug,
}: OrganizationBillingDetailsProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.BillingDetails",
  );
  const tBilling = useTranslations("App.Billing");

  const isOwnerOrAdmin =
    member.role === MemberRole.OWNER || member.role === MemberRole.ADMIN;
  const returnPath = `/organizations/${organizationSlug}`;

  const portalLink =
    isOwnerOrAdmin && billingDetails.stripeCustomerId ? (
      <BalanceBillingPortalLink
        description={tBilling("billingPortalDescription")}
        generalErrorMessage={t("Errors.general")}
        label={tBilling("manageYourBilling")}
        openingLabel={tBilling("openingBillingPortal")}
        organizationId={organization.id}
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
