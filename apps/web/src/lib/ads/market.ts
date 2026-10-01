import {
  AdMarketCountryCode,
  AdMarketLanguageCode,
  type AdMarketProfile,
} from "@sokosumi/core-client";
import { PutAdMarketProfileRequestSchema } from "@sokosumi/core-client/schemas";
import * as z from "zod";

const { keywords } = PutAdMarketProfileRequestSchema.properties;

/** How many keywords a market profile holds, and how long each can be: Core's. */
export const MARKET_KEYWORD_LIMIT = keywords.maxItems;
export const MARKET_KEYWORD_MAX_LENGTH = keywords.items.maxLength;

interface MarketProfileMessages {
  keywordsRequired?: string;
  keywordsTooMany?: string;
  countryRequired?: string;
  languageRequired?: string;
}

/**
 * Core's rules for a market profile, for the form (with its translated
 * messages) and for the server action (without).
 */
export function createMarketProfileSchema(
  messages: MarketProfileMessages = {},
) {
  return z.object({
    keywords: z
      .array(z.string().trim().min(1).max(MARKET_KEYWORD_MAX_LENGTH))
      .min(1, messages.keywordsRequired)
      .max(MARKET_KEYWORD_LIMIT, messages.keywordsTooMany),
    countryCode: z.enum(AdMarketCountryCode, {
      error: messages.countryRequired,
    }),
    languageCode: z.enum(AdMarketLanguageCode, {
      error: messages.languageRequired,
    }),
  });
}

export interface MarketOption {
  code: string;
  name: string;
}

/** "Germany", "German": a name in the reader's language, from its code. */
function displayName(
  locale: string,
  type: "region" | "language",
  code: string,
): string {
  const name = new Intl.DisplayNames(locale, { type }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

/** The countries and languages Core supports, named and sorted for `locale`. */
export function marketOptions(locale: string): {
  countries: MarketOption[];
  languages: MarketOption[];
} {
  const named = (type: "region" | "language", codes: string[]) =>
    codes
      .map((code) => ({ code, name: displayName(locale, type, code) }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  return {
    countries: named("region", Object.values(AdMarketCountryCode)),
    languages: named("language", Object.values(AdMarketLanguageCode)),
  };
}

/** "running shoes, trail shoes · Germany · German" */
export function marketSummary(
  profile: NonNullable<AdMarketProfile>,
  locale: string,
): string {
  return [
    profile.keywords.join(", "),
    displayName(locale, "region", profile.countryCode),
    displayName(locale, "language", profile.languageCode),
  ].join(" · ");
}
