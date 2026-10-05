import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { marketAdSchema, marketKeywordSchema } from "@/lib/ads/dataforseo";
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
    // Union-with-null, not `.nullable()`: see `finalizeProjectAdConnectionResponseSchema`.
    profile: z.union([adMarketProfileSchema, z.null()]).openapi({
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
      "Money is USD. Fields DataForSEO does not report are null. trend is the 12 most recent months, oldest to newest, with null volume for months without data.",
  },
);

export const listAdMarketKeywordsResponseSchema = z
  .object({
    keywords: z.array(adMarketKeywordSchema).openapi({
      description: "At most 50, by search volume descending, nulls last",
    }),
    fetchedAt: dateTimeSchema.openapi({
      description: "When DataForSEO was last asked; results are cached for 24h",
    }),
  })
  .openapi("ListAdMarketKeywordsResponse");

export const adMarketAdSchema = marketAdSchema.openapi("AdMarketAd", {
  description:
    "A recent Google ad of a market advertiser. previewImage is a Google-hosted https URL (render it with referrerPolicy no-referrer); previewUrl is the ad on Google's Ads Transparency Center. Both are null when DataForSEO gives none or a non-https URL. Dates are UTC.",
});

export const listAdMarketAdsResponseSchema = z
  .object({
    ads: z.array(adMarketAdSchema).openapi({
      description:
        "At most 40 ads of the last 30 days from the biggest advertisers for the profile keywords, last shown first",
    }),
    fetchedAt: dateTimeSchema.openapi({
      description: "When DataForSEO was last asked; results are cached for 24h",
    }),
  })
  .openapi("ListAdMarketAdsResponse");
