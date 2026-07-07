/** ISO 3166-1 alpha-2 codes commonly used for Stripe billing addresses. */
export const BILLING_COUNTRY_CODES = [
  "AT",
  "AU",
  "BE",
  "BG",
  "BR",
  "CA",
  "CH",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "GR",
  "HR",
  "HU",
  "IE",
  "IN",
  "IT",
  "JP",
  "LT",
  "LU",
  "LV",
  "MT",
  "MX",
  "NL",
  "NO",
  "NZ",
  "PL",
  "PT",
  "RO",
  "SE",
  "SG",
  "SI",
  "SK",
  "US",
  "ZA",
] as const;

export type BillingCountryCode = (typeof BILLING_COUNTRY_CODES)[number];

const COUNTRIES_REQUIRING_STATE = new Set(["AU", "CA", "US"]);

export function billingCountryRequiresState(country: string): boolean {
  return COUNTRIES_REQUIRING_STATE.has(country.toUpperCase());
}

export function getBillingCountryLabel(
  countryCode: string,
  locale: string,
): string {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "region" });
    return displayNames.of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

export function sortBillingCountryCodes(
  countryCodes: readonly string[],
  locale: string,
): string[] {
  return [...countryCodes].sort((left, right) =>
    getBillingCountryLabel(left, locale).localeCompare(
      getBillingCountryLabel(right, locale),
      locale,
    ),
  );
}
