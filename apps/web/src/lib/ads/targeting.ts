import type { AdMarketCountryCode } from "@sokosumi/core-client";

/** The longest place name Core's location search takes. */
export const GOOGLE_LOCATION_QUERY_MAX_LENGTH = 80;

/** A location or language as the form holds it: Google's id and a name to show. */
export interface GoogleTarget {
  id: string;
  name: string;
  /** The longer name, for a hint: "Paris,Texas,United States". */
  detail?: string;
}

/** What the create page hands the form to pick from and start with. */
export interface GoogleTargeting {
  /** Every language Google can target; null when it could not be loaded. */
  languages: GoogleTarget[] | null;
  /** What the project's Market profile suggests; empty without one. */
  defaultLocations: GoogleTarget[];
  defaultLanguages: GoogleTarget[];
}

/**
 * Each Market country's Google geo target constant id. The Market profile
 * stores DataForSEO's `location_code`, which is that id, but the API returns
 * only the country code. Mirrors `AD_MARKET_LOCATIONS` in Core.
 */
export const MARKET_LOCATION_IDS: Record<AdMarketCountryCode, string> = {
  US: "2840",
  GB: "2826",
  DE: "2276",
  FR: "2250",
  ES: "2724",
  IT: "2380",
  NL: "2528",
  CH: "2756",
  AT: "2040",
  BE: "2056",
  IE: "2372",
  CA: "2124",
  AU: "2036",
  BR: "2076",
  MX: "2484",
  IN: "2356",
  JP: "2392",
};

/** Codes that name one language and differ between ISO and Google. */
const SAME_LANGUAGE = [
  ["he", "iw"],
  ["nb", "no"],
  ["fil", "tl"],
];

/** `zh_CN` and `zh-cn` are one code; case does not matter. */
const normalize = (code: string) => code.toLowerCase().replaceAll("_", "-");

/**
 * Google's language for a Market (ISO 639) language code, or undefined when
 * Google has none. Matching ignores case and `-` versus `_`, and knows the few
 * codes the two sides spell differently.
 */
export function matchGoogleLanguage<T extends { code: string }>(
  code: string,
  languages: readonly T[],
): T | undefined {
  const wanted = normalize(code);
  const accepted = new Set(
    SAME_LANGUAGE.find((group) => group.includes(wanted)) ?? [wanted],
  );
  return languages.find(({ code: candidate }) =>
    accepted.has(normalize(candidate)),
  );
}
