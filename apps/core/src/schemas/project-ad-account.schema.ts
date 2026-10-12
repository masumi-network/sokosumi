import { z } from "@hono/zod-openapi";

import {
  PROJECT_AD_PROVIDERS,
  type ProjectAdProvider,
} from "@/config/ads-providers";
import { dateTimeSchema } from "@/helpers/datetime";
import {
  AD_CAMPAIGN_SETTABLE_STATUSES,
  AD_CAMPAIGN_STATUSES,
  AD_RANGES,
  GOOGLE_KEYWORD_MATCH_TYPES,
  GOOGLE_LOCATION_QUERY_PATTERN,
  META_CAMPAIGN_OBJECTIVES,
} from "@/lib/ads/campaigns";
import { projectSocialConnectionProjectParamsSchema } from "@/schemas/project-social-connection.schema";

export const projectAdProviderSchema = z
  .enum(Object.keys(PROJECT_AD_PROVIDERS) as ProjectAdProvider[])
  .openapi("ProjectAdProvider", { example: "google_ads" });

export const projectAdAccountParamsSchema =
  projectSocialConnectionProjectParamsSchema.extend({
    accountId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "accountId", in: "path" },
        example: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      }),
  });

export const projectAdConnectionParamsSchema =
  projectSocialConnectionProjectParamsSchema.extend({
    adConnectionId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "adConnectionId", in: "path" },
        example: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
      }),
  });

export const projectAdConnectionStatusSchema = z.enum([
  "active",
  "reauthorization_required",
  "disconnected",
]);

export const projectAdConnectionSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Pass this as `adConnectionId` when attaching accounts",
      example: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
    }),
    provider: projectAdProviderSchema,
    status: projectAdConnectionStatusSchema,
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectAdConnection");

const availableAdAccountFields = {
  externalAccountId: z.string().openapi({
    description: "Google customer id or Meta `act_…` id",
    example: "1234567890",
  }),
  name: z.string().openapi({ example: "Sokosumi Ads" }),
  currency: z.string().openapi({
    description: "ISO 4217 code; money is a decimal in this currency",
    example: "EUR",
  }),
  timeZone: z.string().nullable().openapi({ example: "Europe/Berlin" }),
};

export const availableAdAccountSchema = z
  .object(availableAdAccountFields)
  .openapi("AvailableAdAccount");

export const projectAdAccountSchema = z
  .object({
    id: z.string().uuid(),
    connectionId: z.string().uuid(),
    provider: projectAdProviderSchema,
    ...availableAdAccountFields,
    loginCustomerId: z.string().nullable().openapi({
      description: "Google manager account reaching this account, if any",
    }),
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectAdAccount");

export const initiateProjectAdConnectionRequestSchema = z
  .object({ provider: projectAdProviderSchema })
  .openapi("InitiateProjectAdConnectionRequest");

export const finalizeProjectAdConnectionResponseSchema = z
  .object({
    // Union-with-null, not `.nullable()`: `.nullable()` on a named schema drops
    // `| null` from the OpenAPI doc, so the generated client types it non-null
    // and its transformer reads `data.connection.createdAt` unguarded.
    connection: z.union([projectAdConnectionSchema, z.null()]).openapi({
      description:
        "Null when the account reaches no ad accounts: nothing is stored and the authorization is revoked",
    }),
    availableAccounts: z.array(availableAdAccountSchema),
  })
  .openapi("FinalizeProjectAdConnectionResponse");

export const attachProjectAdAccountsRequestSchema = z
  .object({
    adConnectionId: z.string().uuid().openapi({
      description: "The connection `id` returned by finalize",
    }),
    externalAccountIds: z.array(z.string().min(1)).min(1).max(50),
  })
  .openapi("AttachProjectAdAccountsRequest");

export const adRangeSchema = z
  .enum(AD_RANGES)
  .openapi("AdRange", { example: "LAST_30_DAYS" });

export const listAdCampaignsQuerySchema = z.object({
  range: adRangeSchema.default("LAST_30_DAYS").openapi({
    param: { name: "range", in: "query" },
    description:
      "Metrics window: the last 7 or 30 complete days, excluding today",
  }),
});

export const adCampaignSchema = z
  .object({
    id: z.string().openapi({ description: "Provider campaign id" }),
    name: z.string(),
    status: z.enum(AD_CAMPAIGN_STATUSES),
    objective: z.string().nullable().openapi({
      description: "Google channel type or Meta objective",
      example: "SEARCH",
    }),
    dailyBudget: z.number().nullable().openapi({
      description: "Decimal in the account currency",
      example: 25.5,
    }),
    spend: z.number().openapi({ description: "Over the range, decimal" }),
    impressions: z.number(),
    clicks: z.number(),
    ctr: z.number().nullable().openapi({
      description: "clicks / impressions; null without impressions",
    }),
    cpc: z.number().nullable().openapi({
      description: "spend / clicks; null without clicks",
    }),
    conversions: z.number().nullable().openapi({
      description: "Null when the provider does not report conversions (Meta)",
    }),
  })
  .openapi("AdCampaign");

export const listAdCampaignsResponseSchema = z
  .object({
    campaigns: z.array(adCampaignSchema),
    range: adRangeSchema,
    currency: z.string().openapi({
      description: "ISO 4217 code of the ad account; money is in this currency",
      example: "EUR",
    }),
  })
  .openapi("ListAdCampaignsResponse");

export const projectAdCampaignParamsSchema =
  projectAdAccountParamsSchema.extend({
    campaignId: z
      .string()
      .regex(/^\d+$/)
      .openapi({
        param: { name: "campaignId", in: "path" },
        description: "Provider campaign id (digits)",
        example: "23850000000000000",
      }),
  });

export const updateAdCampaignRequestSchema = z
  .object({
    status: z.enum(AD_CAMPAIGN_SETTABLE_STATUSES).optional(),
    dailyBudget: z.number().positive().optional().openapi({
      description:
        "Decimal in the account currency, greater than 0, with at most the currency's decimal places (JPY 0, USD 2)",
      example: 25.5,
    }),
  })
  .refine(
    (body) => body.status !== undefined || body.dailyBudget !== undefined,
    {
      message: "Set status, dailyBudget or both",
    },
  )
  .openapi("UpdateAdCampaignRequest");

const googleIdsSchema = (what: string) =>
  z
    .array(z.string().regex(/^\d+$/).max(20))
    .max(25)
    .openapi({ description: `${what}; none targets all`, example: ["2276"] });

const googleKeywordSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((text) => text.split(/\s+/).length <= 10, {
        message: "A keyword has at most 10 words",
      })
      .openapi({
        description: "Plain text, without quotes or brackets",
        example: "running shoes",
      }),
    matchType: z.enum(GOOGLE_KEYWORD_MATCH_TYPES),
  })
  .openapi("GoogleKeyword");

const googleAdTextsSchema = (min: number, max: number, length: number) =>
  z.array(z.string().trim().min(1).max(length)).min(min).max(max);

// Not z.iso.date(): that is `format: date` in the OpenAPI document, which the
// generated client reads as a Date and would send as a timestamp.
const googleDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => z.iso.date().safeParse(date).success, {
    message: "Not a calendar date",
  })
  .openapi({ example: "2026-11-01" });

// Fields every campaign type has. Add a type by adding a member to
// googleCampaignSpecSchema.
const googleCampaignSpecShape = {
  startDate: googleDate.optional().openapi({
    description:
      "Campaign starts at 00:00:00 of this day in the account's time zone",
  }),
  endDate: googleDate.optional().openapi({
    description:
      "Campaign ends at 23:59:59 of this day in the account's time zone; not before startDate",
  }),
  locationIds: googleIdsSchema("Geo target constant ids (0-25)"),
  languageIds: googleIdsSchema("Language constant ids (0-25)"),
  finalUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .openapi({ example: "https://example.com/spring" }),
};

const googleSearchCampaignSpecSchema = z
  .object({
    type: z.literal("SEARCH"),
    ...googleCampaignSpecShape,
    keywords: z.array(googleKeywordSchema).min(1).max(50).openapi({
      description:
        "Repeats of a keyword with the same match type (ignoring case) are dropped",
    }),
    headlines: googleAdTextsSchema(3, 15, 30).refine(
      (texts) =>
        new Set(texts.map((text) => text.toLowerCase())).size === texts.length,
      { message: "Headlines must be unique (ignoring case)" },
    ),
    descriptions: googleAdTextsSchema(2, 4, 90),
    path1: z.string().trim().min(1).max(15).optional(),
    path2: z.string().trim().min(1).max(15).optional().openapi({
      description: "Requires path1",
    }),
  })
  .refine((spec) => spec.path1 !== undefined || spec.path2 === undefined, {
    message: "path2 needs path1",
    path: ["path2"],
  })
  .openapi("GoogleSearchCampaignSpec");

export const googleCampaignSpecSchema = z
  .discriminatedUnion("type", [googleSearchCampaignSpecSchema])
  .refine(
    ({ startDate, endDate }) =>
      startDate === undefined || endDate === undefined || endDate >= startDate,
    { message: "endDate must not be before startDate", path: ["endDate"] },
  )
  .openapi("GoogleCampaignSpec");

export const createAdCampaignRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(255).openapi({ example: "Spring sale" }),
    dailyBudget: z.number().positive().openapi({
      description:
        "Decimal in the account currency, greater than 0, with at most the currency's decimal places (JPY 0, USD 2)",
      example: 25.5,
    }),
    objective: z.enum(META_CAMPAIGN_OBJECTIVES).optional().openapi({
      description: "Required for Meta ad accounts; 422 for Google",
    }),
    google: googleCampaignSpecSchema.optional().openapi({
      description: "Required for Google ad accounts; 422 for Meta",
    }),
  })
  .openapi("CreateAdCampaignRequest", {
    description: "There is no status: a new campaign is always created paused",
  });

export const createAdCampaignResponseSchema = z
  .object({
    id: z.string().openapi({ description: "Provider campaign id" }),
  })
  .openapi("CreateAdCampaignResponse");

export const searchGoogleLocationsQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .regex(GOOGLE_LOCATION_QUERY_PATTERN, {
        message: "2-60 characters: letters, digits, spaces and . , - ( ) only",
      })
      .optional()
      .openapi({
        param: { name: "q", in: "query" },
        description:
          "Text the location name contains (2-60 letters, digits, spaces and `.,-()`); send either `q` or `ids`",
        example: "Berlin",
      }),
    ids: z
      .string()
      .regex(/^\d{1,20}(,\d{1,20}){0,24}$/, {
        message: "1-25 comma-separated ids, digits only",
      })
      .optional()
      .openapi({
        param: { name: "ids", in: "query" },
        description:
          "Comma-separated geo target constant ids (1-25); send either `q` or `ids`",
        example: "2276,2840",
      }),
  })
  .refine(({ q, ids }) => (q === undefined) !== (ids === undefined), {
    message: "Send either q or ids",
  });

export const googleLocationSchema = z
  .object({
    id: z.string().openapi({
      description: "Geo target constant id; pass it in `google.locationIds`",
      example: "2276",
    }),
    name: z.string().openapi({ example: "Germany" }),
    canonicalName: z.string().openapi({ example: "Berlin,Berlin,Germany" }),
    targetType: z.string().nullable().openapi({
      description: "Null when Google omits it",
      example: "City",
    }),
    countryCode: z.string().nullable().openapi({
      description: "Null when Google omits it",
      example: "DE",
    }),
  })
  .openapi("GoogleLocation");

export const listGoogleLocationsResponseSchema = z
  .object({ locations: z.array(googleLocationSchema).max(20) })
  .openapi("ListGoogleLocationsResponse");

export const googleLanguageSchema = z
  .object({
    id: z.string().openapi({
      description: "Language constant id; pass it in `google.languageIds`",
      example: "1001",
    }),
    code: z.string().openapi({ example: "de" }),
    name: z.string().openapi({ example: "German" }),
  })
  .openapi("GoogleLanguage");

export const listGoogleLanguagesResponseSchema = z
  .object({ languages: z.array(googleLanguageSchema) })
  .openapi("ListGoogleLanguagesResponse");
