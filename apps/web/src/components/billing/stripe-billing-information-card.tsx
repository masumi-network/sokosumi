"use client";

import { MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";
import { getBillingCountryLabel } from "@/lib/constants/billing-countries";

export interface StripeBillingInformationCardProps {
  billingDetails: StripeCustomerBillingDetails;
  portalLink?: ReactNode;
  translationNamespace:
    | "App.Account.BillingDetails"
    | "App.Organizations.OrganizationDetail.BillingDetails";
}

function formatAddressLine(
  billingDetails: StripeCustomerBillingDetails,
  locale: string,
): string | null {
  const { address } = billingDetails;
  if (!address) {
    return null;
  }

  const countryLabel = getBillingCountryLabel(address.country, locale);
  const locality = [address.postalCode, address.city].filter(Boolean).join(" ");
  const region = address.state ? `${address.state}, ` : "";

  return [
    address.line1,
    address.line2,
    `${locality}${locality ? ", " : ""}${region}${countryLabel}`,
  ]
    .filter((line) => line && line.trim().length > 0)
    .join("\n");
}

export function StripeBillingInformationCard({
  billingDetails,
  portalLink,
  translationNamespace,
}: StripeBillingInformationCardProps) {
  const t = useTranslations(translationNamespace);
  const locale = useLocale();
  const formattedAddress = formatAddressLine(billingDetails, locale);
  const primaryTaxId = billingDetails.taxIds[0];

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

        {primaryTaxId ? (
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">{t("taxIdLabel")}</p>
            <p>{primaryTaxId.value}</p>
            {primaryTaxId.verificationStatus ? (
              <p className="text-muted-foreground text-xs">
                {t("taxIdVerification", {
                  status: primaryTaxId.verificationStatus,
                })}
              </p>
            ) : null}
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
