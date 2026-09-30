import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { marketKeywordSchema } from "@/lib/ads/dataforseo";
import {
  AD_MARKET_LANGUAGES,
  AD_MARKET_LOCATIONS,
  type AdMarketCountryCode,
} from "@/lib/ads/markets";

export const adMarketCountryCodeSchema = z
  .enum(Object.keys(AD_MARKET_LOCATIONS) as AdMarketCountryCode[])
  .openapi("AdMarketCountryCode", {
    description: "ISO 3166-1 alpha-2 code of a supported market",
    example: "DE",
  });

export const adMarketLanguageCodeSchema = z
  .enum(AD_MARKET_LANGUAGES)
  .openapi("AdMarketLanguageCode", { example: "de" });

export const putAdMarketProfileRequestSchema = z
  .object({
    keywords: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(10)
      .openapi({
        description:
          "1 to 10 keywords of at most 80 characters; duplicates (ignoring case) are dropped",
        example: ["running shoes"],
      }),
    countryCode: adMarketCountryCodeSchema,
    languageCode: adMarketLanguageCodeSchema,
  })
  .openapi("PutAdMarketProfileRequest");

export const adMarketProfileSchema = z
  .object({
    keywords: z.array(z.string()),
    countryCode: adMarketCountryCodeSchema,
    languageCode: adMarketLanguageCodeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("AdMarketProfile");

export const getAdMarketProfileResponseSchema = z
  .object({
    profile: adMarketProfileSchema.nullable().openapi({
      description: "Null until a market profile is saved",
    }),
  })
  .openapi("GetAdMarketProfileResponse");

export const putAdMarketProfileResponseSchema = z
  .object({ profile: adMarketProfileSchema })
  .openapi("PutAdMarketProfileResponse");

export const adMarketKeywordSchema = marketKeywordSchema.openapi(
  "AdMarketKeyword",
  {
    description:
      "Money is USD. Fields DataForSEO does not report are null. trend runs oldest to newest.",
  },
);

export const listAdMarketKeywordsResponseSchema = z
  .object({
    keywords: z.array(adMarketKeywordSchema).openapi({
      description: "At most 50, by search volume descending, nulls last",
    }),
    currency: z.literal("USD"),
    fetchedAt: dateTimeSchema.openapi({
      description: "When DataForSEO was last asked; results are cached for 24h",
    }),
  })
  .openapi("ListAdMarketKeywordsResponse");
