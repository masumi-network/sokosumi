import type { ReactNode } from "react";

import type { StripeBillingInformationFieldsContent } from "@/lib/billing/build-stripe-billing-information-fields-props";

export type StripeBillingInformationTranslationNamespace =
  | "App.Account.BillingDetails"
  | "App.Organizations.OrganizationDetail.BillingDetails"
  | "App.Admin.Invoices.Form.BillingDetails";

export interface StripeBillingInformationFieldsProps
  extends StripeBillingInformationFieldsContent {
  portalLink?: ReactNode;
}

export function StripeBillingInformationFields({
  addressLabel,
  formattedAddress,
  emptyAddressText,
  invoiceEmailLabel,
  invoiceEmail,
  invoiceEmailEmpty,
  taxIdLabel,
  taxIds,
  portalLink,
}: StripeBillingInformationFieldsProps) {
  const addressField = (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {addressLabel}
      </p>
      {formattedAddress ? (
        <p className="text-sm whitespace-pre-line">{formattedAddress}</p>
      ) : (
        <p className="text-muted-foreground text-sm">{emptyAddressText}</p>
      )}
    </div>
  );

  const taxIdField =
    taxIds.length > 0 ? (
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {taxIdLabel}
        </p>
        {taxIds.map((taxId) => (
          <div key={taxId.id} className="space-y-0.5 text-sm">
            <p>{taxId.value}</p>
            {taxId.verificationStatusText ? (
              <p className="text-muted-foreground text-xs">
                {taxId.verificationStatusText}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    ) : null;

  const emailField = (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {invoiceEmailLabel}
      </p>
      <p className="text-sm">
        {invoiceEmail ?? (
          <span className="text-muted-foreground">{invoiceEmailEmpty}</span>
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
