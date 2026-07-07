const EU_VAT_COUNTRY_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

/** Maps an ISO 3166-1 alpha-2 country code to a Stripe customer tax ID type. */
const COUNTRY_TO_STRIPE_TAX_ID_TYPE: Record<string, string> = {
  AU: "au_abn",
  CA: "ca_bn",
  CH: "ch_vat",
  GB: "gb_vat",
  IN: "in_gst",
  JP: "jp_cn",
  MX: "mx_rfc",
  NO: "no_vat",
  NZ: "nz_gst",
  SG: "sg_uen",
  US: "us_ein",
  ZA: "za_vat",
};

export function inferStripeTaxIdTypeForCountry(country: string): string | null {
  const normalizedCountry = country.trim().toUpperCase();
  if (EU_VAT_COUNTRY_CODES.has(normalizedCountry)) {
    return "eu_vat";
  }

  return COUNTRY_TO_STRIPE_TAX_ID_TYPE[normalizedCountry] ?? null;
}
