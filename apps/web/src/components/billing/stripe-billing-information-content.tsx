"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { formatStripeBillingAddress } from "@/lib/billing/format-stripe-billing-address";
import { formatStripeTaxIdVerificationStatus } from "@/lib/billing/format-stripe-tax-id-verification-status";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

export type StripeBillingInformationTranslationNamespace =
  | "App.Account.BillingDetails"
  | "App.Organizations.OrganizationDetail.BillingDetails"
  | "App.Admin.Invoices.Form.BillingDetails";

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
  const formattedAddress = billingDetails.address
    ? formatStripeBillingAddress(billingDetails.address, locale)
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">{t("addressLabel")}</p>
        {formattedAddress ? (
          <p className="text-sm whitespace-pre-line">{formattedAddress}</p>
        ) : (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        )}
      </div>

      {billingDetails.taxIds.length > 0 ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">{t("taxIdLabel")}</p>
          {billingDetails.taxIds.map((taxId) => (
            <div key={taxId.id} className="space-y-1 text-sm">
              <p>{taxId.value}</p>
              {taxId.verificationStatus ? (
                <p className="text-muted-foreground text-xs">
                  {formatStripeTaxIdVerificationStatus(
                    t,
                    taxId.verificationStatus,
                  )}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">
          {t("invoiceEmailLabel")}
        </p>
        <p className="text-sm">
          {billingDetails.email ?? (
            <span className="text-muted-foreground">
              {t("invoiceEmailEmpty")}
            </span>
          )}
        </p>
      </div>

      {portalLink ? <div className="border-t pt-2">{portalLink}</div> : null}
    </div>
  );
}
