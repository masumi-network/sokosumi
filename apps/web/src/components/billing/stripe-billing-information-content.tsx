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

  const addressField = (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {t("addressLabel")}
      </p>
      {formattedAddress ? (
        <p className="text-sm whitespace-pre-line">{formattedAddress}</p>
      ) : (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      )}
    </div>
  );

  const taxIdField =
    billingDetails.taxIds.length > 0 ? (
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("taxIdLabel")}
        </p>
        {billingDetails.taxIds.map((taxId) => (
          <div key={taxId.id} className="space-y-0.5 text-sm">
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
    ) : null;

  const emailField = (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
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
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {addressField}
        {emailField}
      </div>
      {taxIdField}
      {portalLink ? <div className="border-t pt-3">{portalLink}</div> : null}
    </div>
  );
}
