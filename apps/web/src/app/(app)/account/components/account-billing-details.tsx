"use client";

import { BillingDetailsSection } from "@/components/billing/billing-details-section";
import { updateMyBillingDetails } from "@/lib/actions";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

interface AccountBillingDetailsProps {
  billingDetails: StripeCustomerBillingDetails;
}

export function AccountBillingDetails({
  billingDetails,
}: AccountBillingDetailsProps) {
  return (
    <BillingDetailsSection
      billingDetails={billingDetails}
      canEdit
      translationNamespace="App.Account.BillingDetails"
      onSave={async (data) => {
        const result = await updateMyBillingDetails({
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
