import { formatStripeBillingAddress } from "@/lib/billing/format-stripe-billing-address";
import { formatStripeTaxIdVerificationStatus } from "@/lib/billing/format-stripe-tax-id-verification-status";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

type BillingDetailsTranslator = (
  key: string,
  values?: Record<string, unknown>,
) => string;

export interface StripeBillingInformationTaxIdField {
  id: string;
  value: string;
  verificationStatusText: string | null;
}

export interface StripeBillingInformationFieldsContent {
  addressLabel: string;
  formattedAddress: string | null;
  emptyAddressText: string;
  invoiceEmailLabel: string;
  invoiceEmail: string | null;
  invoiceEmailEmpty: string;
  taxIdLabel: string;
  taxIds: StripeBillingInformationTaxIdField[];
}

export function buildStripeBillingInformationFieldsProps(
  billingDetails: StripeCustomerBillingDetails,
  t: BillingDetailsTranslator,
  locale: string,
): StripeBillingInformationFieldsContent {
  return {
    addressLabel: t("addressLabel"),
    formattedAddress: billingDetails.address
      ? formatStripeBillingAddress(billingDetails.address, locale)
      : null,
    emptyAddressText: t("empty"),
    invoiceEmailLabel: t("invoiceEmailLabel"),
    invoiceEmail: billingDetails.email,
    invoiceEmailEmpty: t("invoiceEmailEmpty"),
    taxIdLabel: t("taxIdLabel"),
    taxIds: billingDetails.taxIds.map((taxId) => ({
      id: taxId.id,
      value: taxId.value,
      verificationStatusText: taxId.verificationStatus
        ? formatStripeTaxIdVerificationStatus(t, taxId.verificationStatus)
        : null,
    })),
  };
}
