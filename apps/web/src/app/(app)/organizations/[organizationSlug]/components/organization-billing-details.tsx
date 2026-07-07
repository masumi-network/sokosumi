"use client";

import { MemberRole } from "@sokosumi/utils";

import { BillingDetailsSection } from "@/components/billing/billing-details-section";
import { updateOrganizationBillingDetails } from "@/lib/actions";
import type {
  MemberRecord,
  OrganizationRecord,
  StripeCustomerBillingDetails,
} from "@/lib/clients/generated/core";

interface OrganizationBillingDetailsProps {
  billingDetails: StripeCustomerBillingDetails;
  member: MemberRecord;
  organization: OrganizationRecord;
}

export default function OrganizationBillingDetails({
  billingDetails,
  member,
  organization,
}: OrganizationBillingDetailsProps) {
  const isOwnerOrAdmin =
    member.role === MemberRole.OWNER || member.role === MemberRole.ADMIN;

  return (
    <BillingDetailsSection
      billingDetails={billingDetails}
      canEdit={isOwnerOrAdmin}
      translationNamespace="App.Organizations.OrganizationDetail.BillingDetails"
      onSave={async (data) => {
        const result = await updateOrganizationBillingDetails({
          organizationId: organization.id,
          address: data.address,
          taxIdValue: data.taxIdValue,
        });

        if (result.ok) {
          return { ok: true as const };
        }

        return {
          ok: false as const,
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        };
      }}
    />
  );
}
