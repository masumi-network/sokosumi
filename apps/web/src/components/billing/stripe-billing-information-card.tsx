import { MapPin } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatStripeBillingAddress } from "@/lib/billing/format-stripe-billing-address";
import { formatStripeTaxIdVerificationStatus } from "@/lib/billing/format-stripe-tax-id-verification-status";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

export interface StripeBillingInformationCardProps {
  billingDetails: StripeCustomerBillingDetails;
  portalLink?: ReactNode;
  translationNamespace:
    | "App.Account.BillingDetails"
    | "App.Organizations.OrganizationDetail.BillingDetails";
}

export async function StripeBillingInformationCard({
  billingDetails,
  portalLink,
  translationNamespace,
}: StripeBillingInformationCardProps) {
  const t = await getTranslations(translationNamespace);
  const locale = await getLocale();
  const formattedAddress = billingDetails.address
    ? formatStripeBillingAddress(billingDetails.address, locale)
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="size-5" />
          <CardTitle>{t("title")}</CardTitle>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
      </CardContent>
    </Card>
  );
}
