/** ISO 3166-1 alpha-2 country → DataForSEO location code. The only markets Ads supports. */
export const AD_MARKET_LOCATIONS = {
  US: 2840,
  GB: 2826,
  DE: 2276,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
  CH: 2756,
  AT: 2040,
  BE: 2056,
  IE: 2372,
  CA: 2124,
  AU: 2036,
  BR: 2076,
  MX: 2484,
  IN: 2356,
  JP: 2392,
} as const;
export type AdMarketCountryCode = keyof typeof AD_MARKET_LOCATIONS;

export const AD_MARKET_LANGUAGES = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "nl",
  "pt",
  "ja",
] as const;
export type AdMarketLanguageCode = (typeof AD_MARKET_LANGUAGES)[number];

export function countryCodeOfLocation(
  locationCode: number,
): AdMarketCountryCode | null {
  const entry = Object.entries(AD_MARKET_LOCATIONS).find(
    ([, code]) => code === locationCode,
  );
  return entry ? (entry[0] as AdMarketCountryCode) : null;
}

export function isAdMarketLanguage(
  languageCode: string,
): languageCode is AdMarketLanguageCode {
  return (AD_MARKET_LANGUAGES as readonly string[]).includes(languageCode);
}
