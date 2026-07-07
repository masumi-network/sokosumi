import type { StripeCustomerBillingAddress } from "@/lib/clients/generated/core";
import { getBillingCountryLabel } from "@/lib/constants/billing-countries";

export function formatStripeBillingAddress(
  address: StripeCustomerBillingAddress,
  locale: string,
): string {
  const countryLabel =
    address.country.length === 2
      ? getBillingCountryLabel(address.country, locale)
      : address.country;
  const locality = [address.postalCode, address.city].filter(Boolean).join(" ");
  const region = address.state ? `${address.state}, ` : "";
  const localityLine =
    `${locality}${locality ? ", " : ""}${region}${countryLabel}`.trim();

  return [
    address.line1,
    address.line2,
    localityLine.length > 0 ? localityLine : null,
  ]
    .filter((line) => line && line.trim().length > 0)
    .join("\n");
}
