import { countryCodeOfLocation } from "@/lib/ads/markets";
import prisma from "@/lib/db/prisma";
import type { RequestSeoAnalysis } from "@/schemas/project-seo.schema";

type SeoCountry = RequestSeoAnalysis["countryCode"];

const LANGUAGE_OF: Record<SeoCountry, string> = {
  US: "en",
  GB: "en",
  DE: "de",
  AT: "de",
  CH: "de",
  FR: "fr",
  ES: "es",
  IT: "it",
  NL: "nl",
  BR: "pt",
  PT: "pt",
};
/** DataForSEO location codes of the countries an SEO check reads. */
const LOCATION_OF: Record<SeoCountry, number> = {
  US: 2840,
  GB: 2826,
  DE: 2276,
  AT: 2040,
  CH: 2756,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
  BR: 2076,
  PT: 2620,
};
const COUNTRY_OF_TLD: Record<string, SeoCountry> = {
  uk: "GB",
  de: "DE",
  at: "AT",
  ch: "CH",
  fr: "FR",
  es: "ES",
  it: "IT",
  nl: "NL",
  br: "BR",
  pt: "PT",
};

function isSeoCountry(value: string | null): value is SeoCountry {
  return value !== null && value in LANGUAGE_OF;
}

/**
 * The search market CMO reads for a brand: the Project's ad market when one
 * was set, else the country its domain names, else the US in English.
 */
export async function cmoSeoMarket(cuso: {
  projectId: string;
  websiteUrl: string;
}): Promise<{
  countryCode: SeoCountry;
  languageCode: string;
  locationCode: number;
}> {
  const profile = await prisma.projectAdMarketProfile.findUnique({
    where: { projectId: cuso.projectId },
    select: { locationCode: true, languageCode: true },
  });
  const profileCountry = profile
    ? countryCodeOfLocation(profile.locationCode)
    : null;
  if (profile && isSeoCountry(profileCountry))
    return {
      countryCode: profileCountry,
      languageCode: profile.languageCode,
      locationCode: LOCATION_OF[profileCountry],
    };
  const tld = URL.canParse(cuso.websiteUrl)
    ? new URL(cuso.websiteUrl).hostname.split(".").pop()
    : undefined;
  const countryCode = (tld && COUNTRY_OF_TLD[tld]) || "US";
  return {
    countryCode,
    languageCode: LANGUAGE_OF[countryCode],
    locationCode: LOCATION_OF[countryCode],
  };
}
